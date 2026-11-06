metadata name = 'BigForge monthly budget'
metadata description = 'Monthly cost budget on the workload resource group with e-mail alerts. A budget only notifies; it does not stop or delete any resource.'

@description('Name of the budget.')
param name string

@description('Budget amount per month, in the billing currency of the subscription. Must be greater than zero; main.bicep only deploys this module in that case.')
param amount int

@description('E-mail address that receives budget alerts.')
@minLength(5)
param contactEmail string

@description('Alert thresholds as a percentage of the budget, evaluated against actual cost. Values must be unique. One additional alert fires at 100 percent of forecasted cost. A budget allows at most five alerts in total.')
@minLength(1)
@maxLength(4)
param thresholds int[] = [
  50
  80
  100
]

@description('First day of the first budget month, formatted yyyy-MM-dd and set to the first of a month.')
param startDate string

var actualNotifications = toObject(thresholds, threshold => 'actual_${threshold}', threshold => {
  enabled: true
  operator: 'GreaterThan'
  threshold: threshold
  thresholdType: 'Actual'
  contactEmails: [
    contactEmail
  ]
  locale: 'en-us'
})

var forecastNotification = {
  forecast_100: {
    enabled: true
    operator: 'GreaterThan'
    threshold: 100
    thresholdType: 'Forecasted'
    contactEmails: [
      contactEmail
    ]
    locale: 'en-us'
  }
}

resource budget 'Microsoft.Consumption/budgets@2026-06-01' = {
  name: name
  properties: {
    category: 'Cost'
    amount: amount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: startDate
    }
    notifications: union(actualNotifications, forecastNotification)
  }
}

@description('Name of the budget.')
output name string = budget.name
