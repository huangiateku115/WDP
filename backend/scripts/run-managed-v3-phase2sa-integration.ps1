[CmdletBinding()]
param(
    [ValidateSet('Preflight', 'Write')]
    [string]$Mode = 'Preflight',
    [string]$RunId,
    [string]$ApprovedPlanHash,
    [ValidateSet('IT01', 'IT02', 'IT03', 'IT04', 'IT05', 'IT06', 'IT07', 'IT08', 'IT09', 'IT10')]
    [string]$CaseId
)

$ErrorActionPreference = 'Stop'
$backendRoot = Split-Path -Parent $PSScriptRoot
$previousTestRun = $env:MI_V3_RUN_MONGODB_TESTS
$previousRunId = $env:MI_V3_TEST_RUN_ID
$previousDatabase = $env:MI_V3_APPROVED_DATABASE
$previousPlanHash = $env:MI_V3_APPROVED_PLAN_HASH
$previousCaseId = $env:MI_V3_TEST_CASE
Push-Location $backendRoot
try {
    if (-not $RunId) {
        $RunId = 'MI3-' + [Guid]::NewGuid().ToString('N')
    }
    if ($RunId -notmatch '^[a-zA-Z0-9-]{8,80}$') {
        throw 'RunId must contain 8-80 alphanumeric, dash characters.'
    }
    if ($CaseId) { $env:MI_V3_TEST_CASE = $CaseId } else { Remove-Item Env:MI_V3_TEST_CASE -ErrorAction SilentlyContinue }

    Write-Host "Phase 2S-C0 read-only preflight for run $RunId"
    $preflightOutput = & node scripts/managed-v3-phase2sa-preflight.cjs $RunId 2>&1
    $preflightExit = $LASTEXITCODE
    $preflightOutput | ForEach-Object { Write-Output $_ }
    $jsonText = ($preflightOutput | Out-String).Trim()
    try { $plan = $jsonText | ConvertFrom-Json } catch { throw 'Could not parse preflight JSON; write mode is refused.' }

    if ($Mode -eq 'Preflight') {
        Write-Host "Preflight exit: $preflightExit. No database writes were requested."
        exit $preflightExit
    }

    $expectedCaseId = if ($CaseId) { $CaseId } else { $null }
    if ($plan.selectedCaseId -ne $expectedCaseId) {
        throw 'Preflight selectedCaseId does not match -CaseId. No write tests were started.'
    }
    if ($CaseId -and $plan.scopedPlanStatus -ne 'VERIFIED') {
        throw 'The selected case write envelope is not verified. No write tests were started.'
    }

    if ($preflightExit -ne 0 -or $plan.status -ne 'READ_ONLY_PREFLIGHT_PASS') {
        throw 'Read-only preflight did not pass. No write tests were started.'
    }
    if ($plan.writeApprovalReady -ne $true -or $plan.approvalState -ne 'READY_FOR_HUMAN_APPROVAL' -or $plan.humanApproval -ne 'NOT_GIVEN') {
        throw 'Technical preflight is blocked or has not reached the human review checkpoint. No write tests were started.'
    }
    if (-not $ApprovedPlanHash -or $ApprovedPlanHash -ne $plan.planHash) {
        throw "Write mode requires -ApprovedPlanHash equal to the reviewed plan hash: $($plan.planHash)"
    }
    if ($plan.database -ne 'test') { throw 'Refusing write mode outside database test.' }

    $env:MI_V3_RUN_MONGODB_TESTS = 'YES'
    $env:MI_V3_TEST_RUN_ID = $RunId
    $env:MI_V3_APPROVED_DATABASE = $plan.database
    $env:MI_V3_APPROVED_PLAN_HASH = $ApprovedPlanHash
    $selectionLabel = 'full'
    if ($CaseId) { $selectionLabel = $CaseId }
    Write-Host "Explicit plan hash supplied. Starting opted-in $selectionLabel test selection after human review; fixture records are retained and no cleanup will run."
    & node --test --test-reporter=spec tests/integration/managed-inventory-v3-mongo-todo.test.cjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    if ($null -eq $previousTestRun) { Remove-Item Env:MI_V3_RUN_MONGODB_TESTS -ErrorAction SilentlyContinue } else { $env:MI_V3_RUN_MONGODB_TESTS = $previousTestRun }
    if ($null -eq $previousRunId) { Remove-Item Env:MI_V3_TEST_RUN_ID -ErrorAction SilentlyContinue } else { $env:MI_V3_TEST_RUN_ID = $previousRunId }
    if ($null -eq $previousDatabase) { Remove-Item Env:MI_V3_APPROVED_DATABASE -ErrorAction SilentlyContinue } else { $env:MI_V3_APPROVED_DATABASE = $previousDatabase }
    if ($null -eq $previousPlanHash) { Remove-Item Env:MI_V3_APPROVED_PLAN_HASH -ErrorAction SilentlyContinue } else { $env:MI_V3_APPROVED_PLAN_HASH = $previousPlanHash }
    if ($null -eq $previousCaseId) { Remove-Item Env:MI_V3_TEST_CASE -ErrorAction SilentlyContinue } else { $env:MI_V3_TEST_CASE = $previousCaseId }
    Pop-Location
}
