[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$backendRoot = Split-Path -Parent $PSScriptRoot
Push-Location $backendRoot
try {
    Write-Host '=== MongoDB read-only connection/schema diagnostic ==='
    node scripts/managed-v3-readonly-diagnostic.cjs
    $mongoDiagnosticExit = $LASTEXITCODE
    Write-Host "Mongo diagnostic exit: $mongoDiagnosticExit (read-only; no Mongo writes performed)"

    Write-Host '=== TypeScript no-emit ==='
    npx tsc --noEmit
    $typecheckExit = $LASTEXITCODE
    Write-Host "TypeScript exit: $typecheckExit"

    Write-Host '=== Backend build ==='
    npm run build
    $buildExit = $LASTEXITCODE
    Write-Host "Build exit: $buildExit"

    Write-Host '=== Unit/mock regression suites (no Mongo integration suites) ==='
    node --test --test-reporter=spec `
        tests/managed-unified-inbound-domain.test.cjs `
        tests/managed-inventory-v3-confirm.test.cjs `
        tests/managed-inventory-v3-ledger.test.cjs `
        tests/managed-inventory-v3-relocation.test.cjs `
        tests/managed-v3-direct-outbound.test.cjs `
        tests/managed-access-policy.test.cjs `
        tests/managed-access-routes.test.cjs `
        tests/managed-access-service.test.cjs `
        tests/managed-canonical-relocation.test.cjs `
        tests/managed-outbound-request-api.test.cjs `
        tests/payos-payment.test.cjs
    $unitExit = $LASTEXITCODE
    Write-Host "Unit/mock suite exit: $unitExit"
    Write-Host 'Mongo integration and HTTP E2E were not run by this script.'

    if ($mongoDiagnosticExit -ne 0 -or $typecheckExit -ne 0 -or $buildExit -ne 0 -or $unitExit -ne 0) {
        exit 1
    }
    exit 0
}
finally {
    Pop-Location
}
