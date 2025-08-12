# Blue Green Env Tracker Action

A GitHub Action for managing blue-green deployments using AWS DynamoDB for state tracking. This action provides a simple and reliable way to track which environment (blue or green) is currently active in your deployment pipeline.

## Features

- 🔄 **Toggle between blue and green environments**
- 🗄️ **Persistent state management using AWS DynamoDB**
- 🚀 **Automatic table creation and management**
- 🔒 **Secure AWS credential handling**
- 📊 **Comprehensive logging and error handling**
- 🎯 **Multiple deployment keys support**
- ⚡ **Fast and lightweight operation**

## Quick Start

### Basic Usage

```yaml
- name: Get current active environment
  id: get-active
  uses: DiyRex/blue-green-tracker@v1
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    aws-region: us-east-1
    table-name: my-deployments
    deployment-key: my-service
    action: get-active

- name: Deploy to inactive environment
  run: |
    echo "Deploying to ${{ steps.get-active.outputs.inactive-color }} environment"
    # Your deployment commands here

- name: Switch to new environment
  uses: DiyRex/blue-green-tracker@v1
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    aws-region: us-east-1
    table-name: my-deployments
    deployment-key: my-service
    action: toggle
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `aws-access-key-id` | AWS Access Key ID | ✅ | - |
| `aws-secret-access-key` | AWS Secret Access Key | ✅ | - |
| `aws-region` | AWS Region | ✅ | `us-east-1` |
| `table-name` | DynamoDB table name | ✅ | `blue-green-deployments` |
| `deployment-key` | Unique key for this deployment | ✅ | - |
| `action` | Action to perform | ✅ | - |
| `color` | Color to set (for set-active action) | ❌ | - |
| `initial-color` | Initial color for init action | ❌ | `blue` |

## Actions

### `init`
Initialize a new deployment configuration.

```yaml
- uses: DiyRex/blue-green-tracker@v1
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    deployment-key: my-service
    action: init
    initial-color: blue
```

### `get-active`
Get the currently active environment.

```yaml
- id: check-active
  uses: DiyRex/blue-green-tracker@v1
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    deployment-key: my-service
    action: get-active

- run: echo "Active environment is ${{ steps.check-active.outputs.active-color }}"
```

### `set-active`
Set a specific environment as active.

```yaml
- uses: DiyRex/blue-green-tracker@v1
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    deployment-key: my-service
    action: set-active
    color: green
```

### `get-inactive`
Get the currently inactive environment.

```yaml
- id: check-inactive
  uses: DiyRex/blue-green-tracker@v1
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    deployment-key: my-service
    action: get-inactive

- run: echo "Deploy to ${{ steps.check-inactive.outputs.inactive-color }}"
```

### `toggle`
Switch to the opposite environment.

```yaml
- uses: DiyRex/blue-green-tracker@v1
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    deployment-key: my-service
    action: toggle
```

## Outputs

| Output | Description |
|--------|-------------|
| `active-color` | Currently active color (blue/green) |
| `inactive-color` | Currently inactive color (blue/green) |
| `previous-color` | Previous active color (for set-active/toggle) |
| `table-created` | Whether the DynamoDB table was created |

## Complete Workflow Example

Here's a complete workflow that demonstrates blue-green deployment:

```yaml
name: Blue-Green Deployment

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Initialize deployment state
        id: init
        uses: DiyRex/blue-green-tracker@v1
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
          table-name: my-app-deployments
          deployment-key: my-web-app
          action: init
          initial-color: blue

      - name: Get current deployment state
        id: current
        uses: DiyRex/blue-green-tracker@v1
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
          table-name: my-app-deployments
          deployment-key: my-web-app
          action: get-active

      - name: Deploy to inactive environment
        run: |
          echo "Current active: ${{ steps.current.outputs.active-color }}"
          echo "Deploying to: ${{ steps.current.outputs.inactive-color }}"
          
          # Example deployment commands
          # docker build -t my-app:${{ steps.current.outputs.inactive-color }} .
          # docker push my-app:${{ steps.current.outputs.inactive-color }}
          # kubectl set image deployment/my-app-${{ steps.current.outputs.inactive-color }} \
          #   app=my-app:${{ steps.current.outputs.inactive-color }}

      - name: Run health checks
        run: |
          echo "Running health checks on ${{ steps.current.outputs.inactive-color }} environment"
          # Add your health check logic here
          # curl -f http://my-app-${{ steps.current.outputs.inactive-color }}.example.com/health

      - name: Switch traffic to new environment
        id: switch
        uses: DiyRex/blue-green-tracker@v1
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
          table-name: my-app-deployments
          deployment-key: my-web-app
          action: toggle

      - name: Update load balancer
        run: |
          echo "Switching traffic from ${{ steps.switch.outputs.previous-color }} to ${{ steps.switch.outputs.active-color }}"
          # Update your load balancer/ingress to point to the new environment
          # kubectl patch ingress my-app -p '{"spec":{"rules":[{"host":"my-app.example.com","http":{"paths":[{"path":"/","pathType":"Prefix","backend":{"service":{"name":"my-app-${{ steps.switch.outputs.active-color }}","port":{"number":80}}}}]}}]}}'

      - name: Cleanup old environment
        run: |
          echo "Cleaning up ${{ steps.switch.outputs.inactive-color }} environment"
          # Optional: cleanup old environment
```

## Interactive Usage Examples

### Scenario 1: Check Current Environment

```yaml
- name: What is current active environment?
  id: status
  uses: DiyRex/blue-green-tracker@v1
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    deployment-key: my-service
    action: get-active

- name: Display status
  run: |
    echo "🟢 Active environment: ${{ steps.status.outputs.active-color }}"
    echo "⏸️ Inactive environment: ${{ steps.status.outputs.inactive-color }}"
```

### Scenario 2: Set Specific Environment

```yaml
- name: Set green as current active color
  uses: DiyRex/blue-green-tracker@v1
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    deployment-key: my-service
    action: set-active
    color: green
```

## AWS IAM Permissions

Your AWS credentials need the following DynamoDB permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:CreateTable",
        "dynamodb:DescribeTable",
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:TagResource"
      ],
      "Resource": [
        "arn:aws:dynamodb:*:*:table/blue-green-deployments*"
      ]
    }
  ]
}
```

## Security Best Practices

1. **Store AWS credentials as repository secrets**
2. **Use least-privilege IAM policies**
3. **Consider using IAM roles with OIDC for GitHub Actions**
4. **Regularly rotate AWS access keys**

## Troubleshooting

### Common Issues

**Table not found error**
- Run the `init` action first to create the table and deployment configuration

**Permission denied**
- Verify your AWS credentials have the required DynamoDB permissions
- Check the IAM policy matches the table name pattern

**Invalid color value**
- Ensure color values are exactly "blue" or "green" (case-insensitive)

### Debug Mode

Enable debug logging by setting the `ACTIONS_STEP_DEBUG` secret to `true` in your repository.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- 📖 [Documentation](https://github.com/DiyRex/blue-green-tracker)
- 🐛 [Report Issues](https://github.com/DiyRex/blue-green-tracker/issues)
- 💬 [Discussions](https://github.com/DiyRex/blue-green-tracker/discussions)