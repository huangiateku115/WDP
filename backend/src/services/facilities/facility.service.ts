import FacilityModel from '../../models/facilities/facility.model';
import { FacilityError, parseFacility, parseList, parseStatusBody } from './facility.validation';

function validateId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[a-fA-F0-9]{24}$/.test(id)) {
    throw new FacilityError(400, 'Invalid facility ID');
  }
}
async function execute<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error: unknown) {
    if (error instanceof FacilityError) throw error;
    const databaseError = error as { code?: number; name?: string };
    if (databaseError?.code === 11000) throw new FacilityError(409, 'Facility code already exists');
    if (databaseError?.name === 'ValidationError' || databaseError?.name === 'CastError') {
      throw new FacilityError(400, 'Invalid facility data');
    }
    // Never forward MongoDB error details, including in development.
    throw new FacilityError(500, 'Internal Server Error');
  }
}
export class FacilityService {
  static async createFacility(input: unknown) {
    const data = parseFacility(input);
    return execute(async () => FacilityModel.create(data));
  }
  static async getFacilities(query: unknown) {
    const { page, limit, filter } = parseList(query);
    return execute(async () => {
      const [data, total] = await Promise.all([
        FacilityModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
        FacilityModel.countDocuments(filter).exec(),
      ]);
      return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    });
  }
  static async getFacilityById(id: unknown) {
    validateId(id);
    return execute(async () => {
      const facility = await FacilityModel.findById(id).exec();
      if (!facility) throw new FacilityError(404, 'Facility not found');
      return facility;
    });
  }
  static async updateFacility(id: unknown, input: unknown) {
    validateId(id);
    const data = parseFacility(input, true);
    return this.update(id, data);
  }
  static async updateFacilityStatus(id: unknown, input: unknown) {
    validateId(id);
    return this.update(id, { status: parseStatusBody(input) });
  }
  private static async update(id: string, data: Record<string, unknown>) {
    return execute(async () => {
      const facility = await FacilityModel.findByIdAndUpdate(id, { $set: data }, {
        new: true, runValidators: true,
      }).exec();
      if (!facility) throw new FacilityError(404, 'Facility not found');
      return facility;
    });
  }
}
