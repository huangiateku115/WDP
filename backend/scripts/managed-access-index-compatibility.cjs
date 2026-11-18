const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const orderedKey = value => JSON.stringify(Object.entries(value ?? {}));
const versionAtLeast = (version = [], major, minor = 0, patch = 0) => {
  if (!Array.isArray(version) || version.length < 3 || !version.slice(0, 3).every(Number.isInteger)) return false;
  return version[0] > major || (version[0] === major && (version[1] > minor || (version[1] === minor && version[2] >= patch)));
};

const requiredAccessSessionIndexes = [
  { name: 'managed_access_session_active_reservation_unique', key: { reservationId: 1 }, unique: true,
    partialFilterExpression: { status: 'ACTIVE' } },
  { name: 'managed_access_session_active_scope_unique', key: { scopedReservationIds: 1 }, unique: true,
    partialFilterExpression: { status: 'ACTIVE' } },
];

function sameDefinition(index, expected) {
  return orderedKey(index.key) === orderedKey(expected.key) && Boolean(index.unique) === Boolean(expected.unique) &&
    same(index.partialFilterExpression ?? null, expected.partialFilterExpression ?? null) && Boolean(index.sparse) === false &&
    (index.expireAfterSeconds ?? null) === null && same(index.collation ?? null, null);
}

function classifyRequiredIndex(existingIndexes, expected, serverVersionArray = []) {
  const indexes = existingIndexes ?? [];
  const sameKey = indexes.filter(index => orderedKey(index.key) === orderedKey(expected.key));
  const requiredName = indexes.find(index => index.name === expected.name);
  if (requiredName) {
    return { name: expected.name, key: expected.key,
      status: sameDefinition(requiredName, expected) ? 'SATISFIED' : 'INCOMPATIBLE_OPTIONS',
      reason: sameDefinition(requiredName, expected) ? 'EXACT_REQUIRED_INDEX' : 'REQUIRED_NAME_USED_BY_DIFFERENT_DEFINITION',
      existingNames: [requiredName.name] };
  }

  const equivalent = sameKey.find(index => sameDefinition(index, expected));
  if (equivalent) return { name: expected.name, key: expected.key, status: 'SATISFIED',
    reason: 'EQUIVALENT_OPTIONS_EXIST_WITH_DIFFERENT_NAME', existingNames: [equivalent.name] };
  if (!sameKey.length) return { name: expected.name, key: expected.key, status: 'MISSING', reason: 'NO_INDEX_WITH_KEY_PATTERN', existingNames: [] };

  const version = Array.isArray(serverVersionArray) ? serverVersionArray : [];
  // MongoDB documents coexistence for basic/unique indexes since 5.0; this applies to the
  // diagnostic's only existing conflict case (a basic index alongside a unique partial index).
  const supportsBasicAndUniqueSameKey = versionAtLeast(version, 5, 0, 0);
  if (supportsBasicAndUniqueSameKey && expected.unique && sameKey.every(index => !index.unique)) {
    return { name: expected.name, key: expected.key, status: 'MISSING_COEXISTING_INDEX',
      reason: 'BASIC_INDEX_CAN_COEXIST_WITH_UNIQUE_INDEX_ON_SERVER_VERSION', existingNames: sameKey.map(index => index.name) };
  }
  return { name: expected.name, key: expected.key, status: 'INCOMPATIBLE_OPTIONS',
    reason: supportsBasicAndUniqueSameKey ? 'SAME_KEY_PATTERN_HAS_NON_COEXISTING_OPTIONS' : 'SERVER_VERSION_DOES_NOT_CONFIRM_BASIC_UNIQUE_COEXISTENCE',
    existingNames: sameKey.map(index => index.name) };
}

module.exports = { requiredAccessSessionIndexes, sameDefinition, classifyRequiredIndex };
