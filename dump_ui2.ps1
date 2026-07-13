Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$zalo = Get-Process -Name "Zalo" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $zalo) { exit }
$handle = $zalo.MainWindowHandle
$auto = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
# Wake up accessibility
$auto.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button))) | Out-Null
Start-Sleep -Milliseconds 500

$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)
$texts = $auto.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
foreach ($t in $texts) { Write-Host ("Text: '" + $t.Current.Name + "'") }

$condBtn = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$btns = $auto.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condBtn)
foreach ($b in $btns) { Write-Host ("Button: '" + $b.Current.Name + "'") }
