const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

/**
 * Dummy coach/user accounts are not seeded.
 * Create accounts through registration (self-serve or Admin dashboard)
 * so email and phone are only stored when someone actually enters them.
 */
async function seed() {
  try {
    if (!process.env.MONGO_URI) {
      console.log('MONGO_URI is not set. Nothing to seed.');
      process.exit(0);
      return;
    }
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');
    console.log('Dummy account seeding is disabled. Register users and coaches through the app.');
    process.exit(0);
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  }
}

seed();
