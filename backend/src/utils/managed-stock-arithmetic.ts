const MAX_SAFE_UNITS = BigInt(Number.MAX_SAFE_INTEGER);

interface DecimalParts { coefficient: bigint; scale: number }

function decimalParts(value: number): DecimalParts | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const [mantissa, exponentText] = value.toString().toLowerCase().split('e');
  if (!mantissa) return null;
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  if (!Number.isInteger(exponent)) return null;
  const [whole = '0', fraction = ''] = mantissa.split('.');
  const digits = `${whole}${fraction}`;
  if (!/^\d+$/.test(digits)) return null;
  let coefficient = BigInt(digits);
  let scale = fraction.length - exponent;
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { coefficient, scale };
}

/** Exact decimal value in the requested precision, or null when it has extra fractional digits. */
export function exactPrecisionUnits(value: number, precision: number): bigint | null {
  const parts = decimalParts(value);
  if (!parts || !Number.isInteger(precision) || precision < 0) return null;
  let units: bigint;
  if (parts.scale <= precision) units = parts.coefficient * 10n ** BigInt(precision - parts.scale);
  else {
    const divisor = 10n ** BigInt(parts.scale - precision);
    if (parts.coefficient % divisor !== 0n) return null;
    units = parts.coefficient / divisor;
  }
  return units <= MAX_SAFE_UNITS ? units : null;
}

/** Multiplies decimal inputs and an integer quantity, then rounds half up once to precision units. */
export function roundedProductUnits(values: number[], quantity: number, precision: number): bigint | null {
  if (!Number.isSafeInteger(quantity) || quantity < 0 || !Number.isInteger(precision) || precision < 0 || !values.length) return null;
  let coefficient = BigInt(quantity);
  let scale = 0;
  for (const value of values) {
    const parts = decimalParts(value);
    if (!parts) return null;
    coefficient *= parts.coefficient;
    scale += parts.scale;
  }
  let units: bigint;
  if (scale <= precision) units = coefficient * 10n ** BigInt(precision - scale);
  else {
    const divisor = 10n ** BigInt(scale - precision);
    units = (coefficient + divisor / 2n) / divisor;
  }
  return units <= MAX_SAFE_UNITS ? units : null;
}

export function precisionUnitsToNumber(units: bigint, precision: number): number | null {
  if (units < 0n || units > MAX_SAFE_UNITS || !Number.isInteger(precision) || precision < 0) return null;
  return Number(units) / 10 ** precision;
}

export function exactUnitsEqual(left: number, rightUnits: bigint, precision: number): boolean {
  const leftUnits = exactPrecisionUnits(left, precision);
  return leftUnits !== null && leftUnits === rightUnits;
}

export function canonicalProductNumber(values: number[], quantity: number, precision: number): number | null {
  const units = roundedProductUnits(values, quantity, precision);
  return units === null ? null : precisionUnitsToNumber(units, precision);
}

export function sumExactPrecisionUnits(values: number[], precision: number): bigint | null {
  let total = 0n;
  for (const value of values) {
    const units = exactPrecisionUnits(value, precision);
    if (units === null) return null;
    total += units;
    if (total > MAX_SAFE_UNITS) return null;
  }
  return total;
}
