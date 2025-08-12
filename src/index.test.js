const { BlueGreenManager } = require('./index');

// Mock AWS SDK
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/lib-dynamodb');
jest.mock('@actions/core');

const mockCore = require('@actions/core');
const { DynamoDBClient, CreateTableCommand, DescribeTableCommand, ResourceNotFoundException } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

describe('BlueGreenManager', () => {
  let manager;
  let mockDocClient;
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock core inputs
    mockCore.getInput.mockImplementation((name) => {
      const inputs = {
        'aws-region': 'us-east-1',
        'aws-access-key-id': 'test-key',
        'aws-secret-access-key': 'test-secret',
        'table-name': 'test-table',
        'deployment-key': 'test-deployment',
        'initial-color': 'blue'
      };
      return inputs[name] || '';
    });

    // Mock AWS clients
    mockClient = {
      send: jest.fn()
    };
    mockDocClient = {
      send: jest.fn()
    };

    DynamoDBClient.mockReturnValue(mockClient);
    DynamoDBDocumentClient.from.mockReturnValue(mockDocClient);

    manager = new BlueGreenManager();
  });

  describe('validateColor', () => {
    test('should accept valid colors', () => {
      expect(manager.validateColor('blue')).toBe('blue');
      expect(manager.validateColor('green')).toBe('green');
      expect(manager.validateColor('BLUE')).toBe('blue');
      expect(manager.validateColor('GREEN')).toBe('green');
    });

    test('should reject invalid colors', () => {
      expect(() => manager.validateColor('red')).toThrow('Color must be either "blue" or "green"');
      expect(() => manager.validateColor('')).toThrow('Color must be either "blue" or "green"');
      expect(() => manager.validateColor(null)).toThrow('Color must be either "blue" or "green"');
    });
  });

  describe('getOppositeColor', () => {
    test('should return opposite colors', () => {
      expect(manager.getOppositeColor('blue')).toBe('green');
      expect(manager.getOppositeColor('green')).toBe('blue');
    });
  });

  describe('ensureTableExists', () => {
    test('should return false if table exists', async () => {
      mockClient.send.mockResolvedValueOnce({ Table: { TableStatus: 'ACTIVE' } });
      
      const result = await manager.ensureTableExists();
      
      expect(result).toBe(false);
      expect(mockClient.send).toHaveBeenCalledWith(expect.any(DescribeTableCommand));
      expect(mockCore.info).toHaveBeenCalledWith('Table test-table already exists');
    });

    test('should create table if it does not exist', async () => {
      const error = new ResourceNotFoundException({
        message: 'Table not found',
        $metadata: {}
      });
      
      mockClient.send
        .mockRejectedValueOnce(error) // DescribeTable fails
        .mockResolvedValueOnce({}) // CreateTable succeeds
        .mockResolvedValueOnce({ Table: { TableStatus: 'ACTIVE' } }); // DescribeTable for wait
      
      const result = await manager.ensureTableExists();
      
      expect(result).toBe(true);
      expect(mockClient.send).toHaveBeenCalledWith(expect.any(CreateTableCommand));
    });
  });

  describe('getDeploymentState', () => {
    test('should return null if no deployment state exists', async () => {
      mockDocClient.send.mockResolvedValueOnce({ Item: null });
      
      const result = await manager.getDeploymentState();
      
      expect(result).toBeNull();
      expect(mockDocClient.send).toHaveBeenCalledWith(expect.any(GetCommand));
    });

    test('should return deployment state if it exists', async () => {
      const mockItem = {
        deployment_key: 'test-deployment',
        active_color: 'blue',
        last_updated: '2023-01-01T00:00:00.000Z',
        metadata: { test: 'data' }
      };
      
      mockDocClient.send.mockResolvedValueOnce({ Item: mockItem });
      
      const result = await manager.getDeploymentState();
      
      expect(result).toEqual({
        activeColor: 'blue',
        lastUpdated: '2023-01-01T00:00:00.000Z',
        metadata: { test: 'data' }
      });
    });
  });

  describe('setDeploymentState', () => {
    test('should set deployment state successfully', async () => {
      process.env.GITHUB_RUN_ID = 'test-run-123';
      process.env.GITHUB_WORKFLOW = 'test-workflow';
      
      mockDocClient.send.mockResolvedValueOnce({});
      
      const result = await manager.setDeploymentState('green', { custom: 'metadata' });
      
      expect(result).toBe('green');
      expect(mockDocClient.send).toHaveBeenCalledWith(expect.any(PutCommand));
      expect(mockCore.info).toHaveBeenCalledWith('Set active color to: green');
    });
  });

  describe('initialize', () => {
    test('should initialize new deployment successfully', async () => {
      // Mock table creation
      const error = new ResourceNotFoundException({
        message: 'Table not found',
        $metadata: {}
      });
      
      mockClient.send
        .mockRejectedValueOnce(error) // Table doesn't exist
        .mockResolvedValueOnce({}) // CreateTable
        .mockResolvedValueOnce({ Table: { TableStatus: 'ACTIVE' } }); // DescribeTable

      // Mock no existing state
      mockDocClient.send.mockResolvedValueOnce({ Item: null });
      
      // Mock state setting
      mockDocClient.send.mockResolvedValueOnce({});
      
      const result = await manager.initialize();
      
      expect(result).toEqual({
        activeColor: 'blue',
        inactiveColor: 'green',
        tableCreated: true,
        wasExisting: false
      });
    });

    test('should handle existing deployment', async () => {
      // Mock table exists
      mockClient.send.mockResolvedValueOnce({ Table: { TableStatus: 'ACTIVE' } });
      
      // Mock existing state
      mockDocClient.send.mockResolvedValueOnce({
        Item: {
          deployment_key: 'test-deployment',
          active_color: 'green',
          last_updated: '2023-01-01T00:00:00.000Z'
        }
      });
      
      const result = await manager.initialize();
      
      expect(result).toEqual({
        activeColor: 'green',
        inactiveColor: 'blue',
        tableCreated: false,
        wasExisting: true
      });
      expect(mockCore.warning).toHaveBeenCalledWith(
        'Deployment test-deployment already exists with active color: green'
      );
    });
  });

  describe('getActive', () => {
    test('should get active deployment state', async () => {
      // Mock table exists
      mockClient.send.mockResolvedValueOnce({ Table: { TableStatus: 'ACTIVE' } });
      
      // Mock existing state
      mockDocClient.send.mockResolvedValueOnce({
        Item: {
          deployment_key: 'test-deployment',
          active_color: 'blue',
          last_updated: '2023-01-01T00:00:00.000Z'
        }
      });
      
      const result = await manager.getActive();
      
      expect(result).toEqual({
        activeColor: 'blue',
        inactiveColor: 'green'
      });
    });

    test('should throw error if no deployment state exists', async () => {
      // Mock table exists
      mockClient.send.mockResolvedValueOnce({ Table: { TableStatus: 'ACTIVE' } });
      
      // Mock no existing state
      mockDocClient.send.mockResolvedValueOnce({ Item: null });
      
      await expect(manager.getActive()).rejects.toThrow(
        'No deployment state found for key: test-deployment. Run \'init\' action first.'
      );
    });
  });

  describe('toggle', () => {
    test('should toggle deployment state successfully', async () => {
      // Mock table exists
      mockClient.send.mockResolvedValueOnce({ Table: { TableStatus: 'ACTIVE' } });
      
      // Mock existing state
      mockDocClient.send.mockResolvedValueOnce({
        Item: {
          deployment_key: 'test-deployment',
          active_color: 'blue',
          last_updated: '2023-01-01T00:00:00.000Z'
        }
      });
      
      // Mock state update
      mockDocClient.send.mockResolvedValueOnce({});
      
      const result = await manager.toggle();
      
      expect(result).toEqual({
        activeColor: 'green',
        inactiveColor: 'blue',
        previousColor: 'blue'
      });
    });

    test('should throw error if no deployment state exists', async () => {
      // Mock table exists
      mockClient.send.mockResolvedValueOnce({ Table: { TableStatus: 'ACTIVE' } });
      
      // Mock no existing state
      mockDocClient.send.mockResolvedValueOnce({ Item: null });
      
      await expect(manager.toggle()).rejects.toThrow(
        'No deployment state found for key: test-deployment. Run \'init\' action first.'
      );
    });
  });

  describe('setActive', () => {
    test('should set active color successfully', async () => {
      mockCore.getInput.mockImplementation((name) => {
        if (name === 'color') return 'green';
        return mockCore.getInput.mockImplementation.mock.calls[0][0] === name ? 'test-value' : '';
      });

      // Mock table exists
      mockClient.send.mockResolvedValueOnce({ Table: { TableStatus: 'ACTIVE' } });
      
      // Mock existing state
      mockDocClient.send.mockResolvedValueOnce({
        Item: {
          deployment_key: 'test-deployment',
          active_color: 'blue',
          last_updated: '2023-01-01T00:00:00.000Z'
        }
      });
      
      // Mock state update
      mockDocClient.send.mockResolvedValueOnce({});
      
      const result = await manager.setActive();
      
      expect(result).toEqual({
        activeColor: 'green',
        inactiveColor: 'blue',
        previousColor: 'blue'
      });
    });

    test('should throw error if color input is missing', async () => {
      mockCore.getInput.mockImplementation((name) => {
        if (name === 'color') return '';
        return 'test-value';
      });
      
      await expect(manager.setActive()).rejects.toThrow(
        'Color input is required for set-active action'
      );
    });
  });
});

describe('Error handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCore.getInput.mockImplementation(() => 'test-value');
  });

  test('should handle AWS SDK errors gracefully', async () => {
    const mockClient = {
      send: jest.fn().mockRejectedValue(new Error('AWS Error'))
    };
    const mockDocClient = {
      send: jest.fn()
    };

    DynamoDBClient.mockReturnValue(mockClient);
    DynamoDBDocumentClient.from.mockReturnValue(mockDocClient);

    const manager = new BlueGreenManager();
    
    await expect(manager.ensureTableExists()).rejects.toThrow('AWS Error');
  });
});