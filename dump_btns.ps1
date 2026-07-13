Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$zalo = Get-Process -Name "Zalo" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $zalo) { exit }
$handle = $zalo.MainWindowHandle
$auto = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$btns = $auto.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
foreach ($b in $btns) { Write-Host ("Button: '" + $b.Current.Name + "'") }
