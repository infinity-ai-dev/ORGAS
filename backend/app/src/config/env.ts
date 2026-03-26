import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

if ((process.env.NODE_ENV || 'development') !== 'production') {
  const envPath = path.resolve(__dirname, '..', '..', '.env.development');
  dotenv.config({ path: envPath, override: true });
}
