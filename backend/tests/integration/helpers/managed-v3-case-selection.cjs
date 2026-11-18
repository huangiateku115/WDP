const scenarioIds = Array.from({ length: 10 }, (_, index) => `IT${String(index + 1).padStart(2, '0')}`);

function selectedIntegrationCaseIds(selectedCase) {
  if (selectedCase == null || selectedCase === '') return [...scenarioIds];
  if (!scenarioIds.includes(selectedCase)) throw new Error('CaseId must be one of IT01 through IT10.');
  return [selectedCase];
}

function shouldRunIntegrationCase(name, { enabled, selectedCase = null } = {}) {
  if (!enabled) return false;
  const caseId = String(name).slice(0, 4);
  return selectedIntegrationCaseIds(selectedCase).includes(caseId);
}

module.exports = { scenarioIds, selectedIntegrationCaseIds, shouldRunIntegrationCase };
