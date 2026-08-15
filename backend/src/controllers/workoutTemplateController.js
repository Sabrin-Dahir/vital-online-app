const WorkoutTemplate = require('../models/WorkoutTemplate');
const { normalizeMediaUrl } = require('../utils/normalizeMediaUrl');
const { validateExercises, requireText } = require('../utils/fieldValidation');
const { rejectIfInvalid } = require('../middleware/validateRequest');

const WORKOUT_PRESETS = [
  'Yoga',
  'Cardio',
  'Strength Training',
  'HIIT',
  'Core',
  'Flexibility',
  'Full Body',
];

function normalizeLevel(level) {
  const map = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
  return map[String(level || '').toLowerCase()] || level || 'Beginner';
}

function normalizeExercises(exercises) {
  if (!Array.isArray(exercises)) return [];
  return exercises.map((entry) => {
    if (typeof entry === 'string') {
      return { name: entry.trim(), sets: 3, reps: 10 };
    }
    return {
      name: entry.name,
      sets: entry.sets ?? 3,
      reps: entry.reps ?? 10,
      durationMinutes: entry.durationMinutes,
      restSeconds: entry.restSeconds,
      equipment: entry.equipment || '',
      instructions: entry.instructions || '',
      notes: entry.notes || '',
      demoImageUrl: normalizeMediaUrl(entry.demoImageUrl),
      demoVideoUrl: normalizeMediaUrl(entry.demoVideoUrl),
    };
  }).filter((e) => e.name && String(e.name).trim());
}

/** If a doc still has nested days from the temporary hierarchy, flatten into exercises. */
function exercisesFromDoc(doc) {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  const flat = normalizeExercises(obj.exercises);
  if (flat.length) return flat;
  if (Array.isArray(obj.days) && obj.days.length) {
    return normalizeExercises(obj.days.flatMap((d) => d.exercises || []));
  }
  return [];
}

function serializeTemplate(doc) {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  obj.exercises = exercisesFromDoc(doc);
  delete obj.days;
  return obj;
}

async function createWorkoutTemplate(req, res) {
  try {
    const { enforceCoachSpecialization } = require('../utils/coachSpecialization');
    if (!enforceCoachSpecialization(req, res, { resourceType: 'workout_template' })) return;

    const { title, description, level, notes, exercises } = req.body;
    if (rejectIfInvalid(res, requireText(title, 'Workout title', { min: 2, max: 120 }))) return;
    if (rejectIfInvalid(res, validateExercises(exercises))) return;
    const normalized = normalizeExercises(exercises);
    if (!normalized.length) return res.status(400).json({ message: 'At least one exercise is required' });

    const template = await WorkoutTemplate.create({
      coach: req.user._id,
      title: title.trim(),
      description: description || '',
      level: normalizeLevel(level),
      notes: notes || '',
      exercises: normalized,
      status: 'active',
    });
    return res.status(201).json(serializeTemplate(template));
  } catch (error) {
    console.error('createWorkoutTemplate:', error.message);
    if (error?.name === 'ValidationError') {
      const first = Object.values(error.errors || {})[0];
      return res.status(400).json({ message: first?.message || 'Invalid workout template' });
    }
    return res.status(500).json({ message: 'Error creating workout template' });
  }
}

async function getWorkoutTemplates(req, res) {
  try {
    const templates = await WorkoutTemplate.find({ coach: req.user._id, status: 'active' })
      .sort({ updatedAt: -1 })
      .lean();
    return res.json(templates.map(serializeTemplate));
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching workout templates' });
  }
}

async function getWorkoutTemplateById(req, res) {
  try {
    const template = await WorkoutTemplate.findOne({
      _id: req.params.id,
      coach: req.user._id,
      status: 'active',
    });
    if (!template) return res.status(404).json({ message: 'Workout template not found' });
    return res.json(serializeTemplate(template));
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching workout template' });
  }
}

async function updateWorkoutTemplate(req, res) {
  try {
    const { enforceCoachSpecialization } = require('../utils/coachSpecialization');
    if (!enforceCoachSpecialization(req, res, { resourceType: 'workout_template' })) return;

    const template = await WorkoutTemplate.findOne({
      _id: req.params.id,
      coach: req.user._id,
      status: 'active',
    });
    if (!template) return res.status(404).json({ message: 'Workout template not found' });

    const { title, description, level, notes, exercises } = req.body;
    if (title !== undefined) template.title = title.trim() || template.title;
    if (description !== undefined) template.description = description;
    if (level !== undefined) template.level = normalizeLevel(level);
    if (notes !== undefined) template.notes = notes;
    if (exercises !== undefined) {
      const normalized = normalizeExercises(exercises);
      if (!normalized.length) return res.status(400).json({ message: 'At least one exercise is required' });
      template.exercises = normalized;
      if (template.days !== undefined) {
        template.set('days', undefined);
      }
    }
    await template.save();
    // Ensure legacy nested days are cleared in DB even if schema no longer defines them
    await WorkoutTemplate.collection.updateOne(
      { _id: template._id },
      { $unset: { days: '' } },
    );
    const fresh = await WorkoutTemplate.findById(template._id);
    return res.json(serializeTemplate(fresh));
  } catch (error) {
    return res.status(500).json({ message: 'Error updating workout template' });
  }
}

async function deleteWorkoutTemplate(req, res) {
  try {
    const template = await WorkoutTemplate.findOneAndUpdate(
      { _id: req.params.id, coach: req.user._id },
      { $set: { status: 'archived' } },
      { new: true, runValidators: true },
    );
    if (!template) return res.status(404).json({ message: 'Workout template not found' });
    return res.json({ message: 'Workout template deleted', template: serializeTemplate(template) });
  } catch (error) {
    return res.status(500).json({ message: 'Error deleting workout template' });
  }
}

function getWorkoutPresets(req, res) {
  return res.json({ presets: WORKOUT_PRESETS });
}

module.exports = {
  createWorkoutTemplate,
  getWorkoutTemplates,
  getWorkoutTemplateById,
  updateWorkoutTemplate,
  deleteWorkoutTemplate,
  getWorkoutPresets,
  normalizeExercises,
  normalizeLevel,
};
