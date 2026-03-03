// logic-app.bicep — Azure Logic App (Teams message trigger → capture function → Teams reply)

@description('Location for all resources')
param location string

@description('Logic App name')
param logicAppName string

@description('Capture function URL (e.g., https://func-secondbrain-xxx.azurewebsites.net/api/capture)')
param captureFunctionUrl string

// Teams API connection (shell — requires manual OAuth authorization after deployment)
resource teamsConnection 'Microsoft.Web/connections@2016-06-01' = {
  name: '${logicAppName}-teams'
  location: location
  properties: {
    displayName: 'Second Brain Teams Connection'
    api: {
      id: subscriptionResourceId('Microsoft.Web/locations/managedApis', location, 'teams')
    }
  }
}

resource logicApp 'Microsoft.Logic/workflows@2019-05-01' = {
  name: logicAppName
  location: location
  properties: {
    state: 'Enabled'
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      triggers: {
        'When_a_new_channel_message_is_added': {
          type: 'ApiConnectionNotification'
          inputs: {
            host: {
              connection: {
                name: '@parameters(\'$connections\')[\'teams\'][\'connectionId\']'
              }
            }
            subscribe: {
              body: {
                NotificationUrl: '@{listCallbackUrl()}'
              }
              method: 'post'
              pathTemplate: {
                template: '/trigger/beta/teams/{teamId}/channels/{channelId}/messages'
              }
            }
            fetch: {
              method: 'get'
              pathTemplate: {
                template: '/trigger/beta/teams/{teamId}/channels/{channelId}/messages'
              }
            }
          }
        }
      }
      actions: {
        'Check_for_brain_hashtag': {
          type: 'If'
          expression: {
            and: [
              {
                contains: [
                  '@triggerBody()?[\'body\']?[\'content\']'
                  '#brain'
                ]
              }
            ]
          }
          actions: {
            'Call_Capture_Function': {
              type: 'Http'
              inputs: {
                method: 'POST'
                uri: captureFunctionUrl
                headers: {
                  'Content-Type': 'application/json'
                }
                body: {
                  userId: '@triggerBody()?[\'from\']?[\'user\']?[\'id\']'
                  content: '@triggerBody()?[\'body\']?[\'content\']'
                  source: 'teams'
                  teamsContext: {
                    teamId: '@triggerBody()?[\'channelIdentity\']?[\'teamId\']'
                    channelId: '@triggerBody()?[\'channelIdentity\']?[\'channelId\']'
                    messageId: '@triggerBody()?[\'id\']'
                    from: '@triggerBody()?[\'from\']?[\'user\']?[\'displayName\']'
                  }
                }
              }
            }
            'Reply_in_Teams': {
              type: 'ApiConnection'
              inputs: {
                host: {
                  connection: {
                    name: '@parameters(\'$connections\')[\'teams\'][\'connectionId\']'
                  }
                }
                method: 'post'
                path: '/beta/teams/conversation/replyWithMessage/poster/Flow bot/location/@{triggerBody()?[\'channelIdentity\']?[\'teamId\']}/@{triggerBody()?[\'channelIdentity\']?[\'channelId\']}/@{triggerBody()?[\'id\']}'
                body: {
                  body: {
                    content: '<p>✅ <strong>Captured to Second Brain!</strong></p><p>Type: @{body(\'Call_Capture_Function\')?[\'metadata\']?[\'type\']}</p><p>Topics: @{join(body(\'Call_Capture_Function\')?[\'metadata\']?[\'topics\'], \', \')}</p>'
                    contentType: 'html'
                  }
                }
              }
              runAfter: {
                'Call_Capture_Function': ['Succeeded']
              }
            }
          }
          else: {
            actions: {}
          }
        }
      }
      parameters: {
        '$connections': {
          defaultValue: {}
          type: 'Object'
        }
      }
    }
    parameters: {
      '$connections': {
        value: {
          teams: {
            connectionId: teamsConnection.id
            connectionName: teamsConnection.name
            id: subscriptionResourceId('Microsoft.Web/locations/managedApis', location, 'teams')
          }
        }
      }
    }
  }
}

output logicAppId string = logicApp.id
output logicAppName string = logicApp.name
output teamsConnectionId string = teamsConnection.id
output teamsConnectionName string = teamsConnection.name
