const core = require('@actions/core');
const { 
  DynamoDBClient, 
  CreateTableCommand, 
  DescribeTableCommand,
  ResourceNotFoundException
} = require('@aws-sdk/client-dynamodb');
const { 
  DynamoDBDocumentClient, 
  GetCommand, 
  PutCommand 
} = require('@aws-sdk/lib-dynamodb');

class BlueGreenManager {
  constructor() {
    this.client = new DynamoDBClient({
      region: core.getInput('aws-region'),
      credentials: {
        accessKeyId: core.getInput('aws-access-key-id'),
        secretAccessKey: core.getInput('aws-secret-access-key')
      }
    });
    this.docClient = DynamoDBDocumentClient.from(this.client);
    this.tableName = core.getInput('table-name');
    this.deploymentKey = core.getInput('deployment-key');
  }

  async ensureTableExists() {
    try {
      await this.client.send(new DescribeTableCommand({ 
        TableName: this.tableName 
      }));
      core.info(`Table ${this.tableName} already exists`);
      return false;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        core.info(`Creating table ${this.tableName}...`);
        await this.createTable();
        return true;
      }
      throw error;
    }
  }

  async createTable() {
    const createTableParams = {
      TableName: this.tableName,
      KeySchema: [
        {
          AttributeName: 'deployment_key',
          KeyType: 'HASH'
        }
      ],
      AttributeDefinitions: [
        {
          AttributeName: 'deployment_key',
          AttributeType: 'S'
        }
      ],
      BillingMode: 'PAY_PER_REQUEST',
      Tags: [
        {
          Key: 'Purpose',
          Value: 'BlueGreenDeployment'
        },
        {
          Key: 'ManagedBy',
          Value: 'GitHubActions'
        }
      ]
    };

    await this.client.send(new CreateTableCommand(createTableParams));
    
    // Wait for table to be active
    core.info('Waiting for table to become active...');
    await this.waitForTableActive();
    core.info('Table created successfully');
  }

  async waitForTableActive() {
    const maxAttempts = 30;
    const delayMs = 5000;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.client.send(
          new DescribeTableCommand({ TableName: this.tableName })
        );
        
        if (response.Table.TableStatus === 'ACTIVE') {
          return;
        }
        
        core.info(`Table status: ${response.Table.TableStatus}. Waiting...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } catch (error) {
        core.warning(`Attempt ${attempt} failed: ${error.message}`);
        if (attempt === maxAttempts) throw error;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    throw new Error('Table did not become active within expected time');
  }

  async getDeploymentState() {
    try {
      const response = await this.docClient.send(new GetCommand({
        TableName: this.tableName,
        Key: { deployment_key: this.deploymentKey }
      }));

      if (!response.Item) {
        return null;
      }

      return {
        activeColor: response.Item.active_color,
        lastUpdated: response.Item.last_updated,
        metadata: response.Item.metadata || {}
      };
    } catch (error) {
      core.error(`Failed to get deployment state: ${error.message}`);
      throw error;
    }
  }

  async setDeploymentState(activeColor, metadata = {}) {
    const item = {
      deployment_key: this.deploymentKey,
      active_color: activeColor,
      last_updated: new Date().toISOString(),
      metadata: {
        ...metadata,
        updated_by: 'github-actions',
        run_id: process.env.GITHUB_RUN_ID || 'unknown',
        workflow: process.env.GITHUB_WORKFLOW || 'unknown'
      }
    };

    try {
      await this.docClient.send(new PutCommand({
        TableName: this.tableName,
        Item: item
      }));
      
      core.info(`Set active color to: ${activeColor}`);
      return activeColor;
    } catch (error) {
      core.error(`Failed to set deployment state: ${error.message}`);
      throw error;
    }
  }

  getOppositeColor(color) {
    return color === 'blue' ? 'green' : 'blue';
  }

  validateColor(color) {
    if (!color || !['blue', 'green'].includes(color.toLowerCase())) {
      throw new Error('Color must be either "blue" or "green"');
    }
    return color.toLowerCase();
  }

  async initialize() {
    const initialColor = core.getInput('initial-color') || 'blue';
    const validatedColor = this.validateColor(initialColor);
    
    const tableCreated = await this.ensureTableExists();
    
    // Check if deployment already exists
    const existingState = await this.getDeploymentState();
    if (existingState) {
      core.warning(`Deployment ${this.deploymentKey} already exists with active color: ${existingState.activeColor}`);
      return {
        activeColor: existingState.activeColor,
        inactiveColor: this.getOppositeColor(existingState.activeColor),
        tableCreated,
        wasExisting: true
      };
    }

    await this.setDeploymentState(validatedColor, { 
      initialized_at: new Date().toISOString(),
      initial_color: validatedColor 
    });
    
    return {
      activeColor: validatedColor,
      inactiveColor: this.getOppositeColor(validatedColor),
      tableCreated,
      wasExisting: false
    };
  }

  async getActive() {
    await this.ensureTableExists();
    
    const state = await this.getDeploymentState();
    if (!state) {
      throw new Error(`No deployment state found for key: ${this.deploymentKey}. Run 'init' action first.`);
    }

    return {
      activeColor: state.activeColor,
      inactiveColor: this.getOppositeColor(state.activeColor)
    };
  }

  async setActive() {
    const color = core.getInput('color');
    if (!color) {
      throw new Error('Color input is required for set-active action');
    }
    
    const validatedColor = this.validateColor(color);
    await this.ensureTableExists();
    
    // Get current state for comparison
    const currentState = await this.getDeploymentState();
    const previousColor = currentState ? currentState.activeColor : null;
    
    await this.setDeploymentState(validatedColor, {
      previous_color: previousColor,
      action: 'set-active'
    });

    return {
      activeColor: validatedColor,
      inactiveColor: this.getOppositeColor(validatedColor),
      previousColor
    };
  }

  async toggle() {
    await this.ensureTableExists();
    
    const currentState = await this.getDeploymentState();
    if (!currentState) {
      throw new Error(`No deployment state found for key: ${this.deploymentKey}. Run 'init' action first.`);
    }

    const newActiveColor = this.getOppositeColor(currentState.activeColor);
    const previousColor = currentState.activeColor;
    
    await this.setDeploymentState(newActiveColor, {
      previous_color: previousColor,
      action: 'toggle'
    });

    return {
      activeColor: newActiveColor,
      inactiveColor: previousColor,
      previousColor
    };
  }
}

async function run() {
  try {
    const action = core.getInput('action').toLowerCase();
    const manager = new BlueGreenManager();
    
    core.info(`Executing action: ${action}`);
    core.info(`Deployment key: ${manager.deploymentKey}`);
    core.info(`Table name: ${manager.tableName}`);

    let result;

    switch (action) {
      case 'init':
        result = await manager.initialize();
        core.setOutput('table-created', result.tableCreated);
        if (result.wasExisting) {
          core.warning('Deployment already existed - returning existing state');
        }
        break;

      case 'get-active':
        result = await manager.getActive();
        break;

      case 'set-active':
        result = await manager.setActive();
        core.setOutput('previous-color', result.previousColor);
        break;

      case 'get-inactive':
        const activeResult = await manager.getActive();
        result = {
          activeColor: activeResult.activeColor,
          inactiveColor: activeResult.inactiveColor
        };
        break;

      case 'toggle':
        result = await manager.toggle();
        core.setOutput('previous-color', result.previousColor);
        break;

      default:
        throw new Error(`Unknown action: ${action}. Valid actions are: init, get-active, set-active, get-inactive, toggle`);
    }

    // Set common outputs
    core.setOutput('active-color', result.activeColor);
    core.setOutput('inactive-color', result.inactiveColor);

    core.info(`✅ Action completed successfully`);
    core.info(`Active color: ${result.activeColor}`);
    core.info(`Inactive color: ${result.inactiveColor}`);

  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
    core.error(error.stack);
  }
}

// Only run if this file is executed directly (not imported)
if (require.main === module) {
  run();
}

module.exports = { BlueGreenManager, run };