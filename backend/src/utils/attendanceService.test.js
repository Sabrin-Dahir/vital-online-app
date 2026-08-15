const assert = require('assert');
const {
  validateStatusForType,
  computeStats,
  allowedStatusesFor,
} = require('./attendanceService');
const Attendance = require('../models/Attendance');

function testStatusRules() {
  assert.strictEqual(validateStatusForType('workout', 'present'), null);
  assert.strictEqual(validateStatusForType('workout', 'no_show') !== null, true);
  assert.strictEqual(validateStatusForType('session', 'completed'), null);
  assert.strictEqual(validateStatusForType('session', 'missed') !== null, true);
  assert.strictEqual(validateStatusForType('group', 'no_show'), null);
  assert.deepStrictEqual(allowedStatusesFor('workout'), Attendance.WORKOUT_STATUSES);
}

function testStats() {
  const stats = computeStats([
    { status: 'present' },
    { status: 'present' },
    { status: 'absent' },
    { status: 'missed' },
    { status: 'no_show' },
    { status: 'cancelled' },
    { status: 'completed' },
  ]);
  assert.strictEqual(stats.present, 2);
  assert.strictEqual(stats.absent, 1);
  assert.strictEqual(stats.missed, 1);
  assert.strictEqual(stats.no_show, 1);
  assert.strictEqual(stats.cancelled, 1);
  assert.strictEqual(stats.completed, 1);
  // 3 positive (2 present + 1 completed) / 6 actionable (excluding cancelled)
  assert.strictEqual(stats.attendancePercentage, 50);
}

testStatusRules();
testStats();
console.log('attendanceService.test.js: ok');
