/**
 * Coach certificate identity: First Name + Last Name only.
 * Run: node backend/src/utils/certificateNameValidation.test.js
 */
const assert = require('assert');
const {
  evaluateCertificateNameText,
  certificateContainsFirstAndLast,
} = require('./certificateNameValidation');

assert.strictEqual(
  certificateContainsFirstAndLast('Certificate of Completion\nAhmed Hassan\nCertified Fitness Trainer', 'Ahmed', 'Hassan'),
  true,
);
assert.strictEqual(certificateContainsFirstAndLast('Ahmed  Hassan', 'Ahmed', 'Hassan'), true);
assert.strictEqual(certificateContainsFirstAndLast('AHMED HASSAN', 'Ahmed', 'Hassan'), true);
assert.strictEqual(certificateContainsFirstAndLast('Ahmed-Hassan', 'Ahmed', 'Hassan'), true);
assert.strictEqual(certificateContainsFirstAndLast('AhmedHassan', 'Ahmed', 'Hassan'), true);

assert.strictEqual(
  certificateContainsFirstAndLast('yasmiin@gmail.com +252 61 0000000', 'Ahmed', 'Hassan'),
  false,
);
assert.strictEqual(
  certificateContainsFirstAndLast('Certificate of Completion Certified Fitness Trainer', 'Ahmed', 'Hassan'),
  false,
);

const extraText = evaluateCertificateNameText(
  'Certificate of Completion\nAhmed Hassan\nCertified Fitness Trainer',
  { firstName: 'Ahmed', lastName: 'Hassan' },
);
assert.strictEqual(extraText.ok, true);

const hyphen = evaluateCertificateNameText('AHMED-HASSAN', {
  firstName: 'Ahmed',
  lastName: 'Hassan',
});
assert.strictEqual(hyphen.ok, true);

const mismatch = evaluateCertificateNameText(
  'Certificate of Completion for Fatima Ali, Certified Fitness Trainer',
  { firstName: 'Ahmed', lastName: 'Hassan' },
);
assert.strictEqual(mismatch.ok, false);
assert.strictEqual(mismatch.code, 'CERTIFICATE_NAME_MISMATCH');

const unreadable = evaluateCertificateNameText('   ', {
  firstName: 'Ahmed',
  lastName: 'Hassan',
});
assert.strictEqual(unreadable.ok, true);
assert.strictEqual(unreadable.unverified, true);

const missingLast = evaluateCertificateNameText('Ahmed Hassan', {
  firstName: 'Ahmed',
  lastName: '',
});
assert.strictEqual(missingLast.ok, false);
assert.strictEqual(missingLast.code, 'CERTIFICATE_NAME_REQUIRED');

const fromExpectedName = evaluateCertificateNameText('Ahmed Hassan', {
  expectedName: 'Ahmed Hassan',
});
assert.strictEqual(fromExpectedName.ok, true);

console.log('certificateNameValidation tests passed');
