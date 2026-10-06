import { model, Schema } from 'mongoose';

// A shared write target serializes interval checks across processes in a transaction.
const schema = new Schema<{ _id: string; sequence: number }>({
  _id: { type: String, required: true },
  sequence: { type: Number, required: true, default: 0 },
}, { versionKey: false });
export default model('RuleScope', schema);
