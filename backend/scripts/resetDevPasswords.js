/**
 * Resets every account password to a predictable local-dev value:
 *   first letter of email local-part uppercased + rest + "111"
 * Example: local-part of the username, first letter uppercased, plus 111
 *
 * Usage: node scripts/resetDevPasswords.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../src/models/User');
const { isBcryptHash } = require('../src/utils/passwordUtils');

function passwordForEmail(email) {
  const local = String(email).split('@')[0];
  return local.charAt(0).toUpperCase() + local.slice(1) + '111';
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/vitalguide');
  const users = await User.find({}).select('+password email name role status');
  console.log(`Resetting ${users.length} account(s)...`);

  for (const user of users) {
    const nextPassword = passwordForEmail(user.email);
    user.password = nextPassword;
    user.markModified('password');
    await user.save();

    const reloaded = await User.findById(user._id).select('+password');
    const ok = isBcryptHash(reloaded.password) && (await reloaded.comparePassword(nextPassword));
    console.log(`${ok ? 'OK' : 'FAIL'} ${user.email} (${user.role}) → ${nextPassword}`);
  }

  await mongoose.disconnect();
  console.log('Done. Sign in with EmailLocal + 111 (e.g. Yasmiin111).');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
