import { Schema, model } from 'mongoose';

export const urlSchema = new Schema({
  original_url: { type: String, required: true },
  short_url: { type: String, required: true },
});

export let Url;
try {
  Url = model('Url', urlSchema);
} catch (e) {
  Url = model('Url');
}
