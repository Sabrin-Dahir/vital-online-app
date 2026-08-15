const mongoose = require('mongoose');
const path = require('path');
const User = require('../models/User');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || '').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

async function reset() {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.error(
      'Set ADMIN_USERNAME and ADMIN_PASSWORD in the environment. '
        + 'This script does not use a built-in email or password.',
    );
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);

    let admin = await User.findOne({ username: ADMIN_USERNAME });

    if (admin) {
      admin.password = ADMIN_PASSWORD;
      admin.role = 'admin';
      admin.full_name = admin.full_name || 'System Admin';
      admin.status = 'active';
      admin.must_change_password = false;
      admin.login_attempts = 0;
      admin.lock_until = null;
      admin.adminData = { permissions: 'super-admin' };
      await admin.save();
      console.log(`Reset admin "${ADMIN_USERNAME}" password`);
    } else {
      await User.create({
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
        role: 'admin',
        full_name: 'System Admin',
        status: 'active',
        must_change_password: false,
        adminData: { permissions: 'super-admin' },
      });
      console.log(`Created admin "${ADMIN_USERNAME}"`);
    }

    const verified = await User.findOne({ username: ADMIN_USERNAME }).select('+password');
    const ok = verified && (await verified.comparePassword(ADMIN_PASSWORD));
    console.log(
      ok
        ? `Verified: role=${verified.role}, must_change_password=${verified.must_change_password}`
        : 'Verification FAILED',
    );
  } catch (err) {
    console.error('Error resetting admin:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
    process.exit(process.exitCode || 0);
  }
}

reset();
