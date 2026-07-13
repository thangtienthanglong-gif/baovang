Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$zalo = Get-Process -Name "Zalo" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $zalo) { Write-Host "Zalo not running"; exit }
$handle = $zalo.MainWindowHandle
$auto = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
function Dump-Node($node, $indent) {
    if ($node -eq $null) { return }
    $name = $node.Current.Name
    $type = $node.Current.ControlType.ProgrammaticName
    $id = $node.Current.AutomationId
    Write-Host (" " * $indent + "- Name: '$name', Type: $type, Id: '$id'")
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $child = $walker.GetFirstChild($node)
    while ($child -ne $null) {
        Dump-Node $child ($indent + 2)
        $child = $walker.GetNextSibling($child)
    }
}
Dump-Node $auto 0
