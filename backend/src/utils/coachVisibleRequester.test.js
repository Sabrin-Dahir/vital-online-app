const test = require('node:test');
const assert = require('node:assert/strict');
const {
  formatCoachVisibleRequester,
  formatCoachRequestForCoach,
} = require('./coachVisibleRequester');

test('formatCoachVisibleRequester exposes fitness profile fields and hides secrets', () => {
  const formatted = formatCoachVisibleRequester({
    _id: 'user1',
    full_name: 'John Doe',
    username: 'john@example.com',
    phone: '252611111111',
    avatar: 'https://cdn.example/a.jpg',
    password: 'secret',
    admin_password: 'plain',
    password_reset_code: '123456',
    login_attempts: 9,
    lock_until: new Date(),
    adminData: { permissions: ['*'] },
    clientData: {
      age: 28,
      gender: 'Male',
      height: 180,
      weight: 78,
      fitness_goal: 'Nutrition',
      activity_level: 'moderate',
      medical_notes: 'Knee discomfort',
      assigned_coach_id: 'other-coach',
      weight_history: [{ weight: 80, date: new Date() }],
    },
    profile: {
      location: 'Banaadir',
      photoUrl: '',
      goals: ['Better nutrition'],
      experience: 'Beginner',
      bio: 'Looking for a coach',
      workingDays: ['Mon'],
      appointmentDays: ['Tue'],
    },
  });

  assert.equal(formatted.name, 'John Doe');
  assert.equal(formatted.fitness_goal, 'Nutrition');
  assert.equal(formatted.location, 'Banaadir');
  assert.equal(formatted.age, 28);
  assert.equal(formatted.gender, 'Male');
  assert.equal(formatted.fitness_level, 'moderate');
  assert.equal(formatted.medical_notes, 'Knee discomfort');
  assert.equal(formatted.password, undefined);
  assert.equal(formatted.admin_password, undefined);
  assert.equal(formatted.password_reset_code, undefined);
  assert.equal(formatted.login_attempts, undefined);
  assert.equal(formatted.adminData, undefined);
  assert.equal(formatted.clientData.assigned_coach_id, undefined);
  assert.equal(formatted.clientData.weight_history, undefined);
  assert.equal(formatted.profile.workingDays, undefined);
});

test('formatCoachRequestForCoach keeps pending status and request metadata', () => {
  const formatted = formatCoachRequestForCoach({
    _id: 'req1',
    status: 'pending',
    message: 'Hi coach',
    createdAt: '2026-08-01T10:00:00.000Z',
    user: {
      _id: 'user1',
      full_name: 'Jane',
      username: 'jane@example.com',
      clientData: { fitness_goal: 'Weight Loss', activity_level: 'active' },
      profile: { location: 'Woqooyi Galbeed' },
    },
  });

  assert.equal(formatted.status, 'pending');
  assert.equal(formatted.message, 'Hi coach');
  assert.equal(formatted.user.fitness_goal, 'Weight Loss');
  assert.equal(formatted.user.location, 'Woqooyi Galbeed');
});
