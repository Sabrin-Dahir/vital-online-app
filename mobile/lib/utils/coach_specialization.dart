/// Coach specialization → allowed services (mirrors backend).

const specializations = <String>[
  'General Fitness',
  'Weight Loss',
  'Weight Gain',
  'Nutrition',
  'Muscle Building',
  'Strength Training',
  'Bodybuilding',
  'Cardio & Endurance',
  'HIIT',
  'Functional Training',
  'Personal Training',
  'Fitness for Beginners',
  "Women's Fitness",
  "Men's Fitness",
  'Senior Fitness',
  'Youth Fitness',
  'Sports Training',
  'Athletic Performance',
  'Flexibility & Mobility',
  'Yoga & Mindfulness',
  'Posture & Corrective Exercise',
  'Injury Prevention',
  'Rehabilitation & Recovery',
  'Pre/Postnatal Fitness',
  'Lifestyle & Wellness',
  'Meal Planning',
  'Healthy Eating',
  'Weight Management',
];

const aliases = <String, String>{
  'general': 'General Fitness',
  'fitness': 'General Fitness',
  'general fitness': 'General Fitness',
  'nutrition': 'Nutrition',
  'weight loss': 'Weight Loss',
  'weightloss': 'Weight Loss',
  'weight-loss': 'Weight Loss',
  'weight_loss': 'Weight Loss',
  'weight gain': 'Weight Gain',
  'muscle building': 'Muscle Building',
  'muscle_gain': 'Muscle Building',
  'strength training': 'Strength Training',
  'bodybuilding': 'Bodybuilding',
  'hiit': 'HIIT',
  'meal planning': 'Meal Planning',
  'healthy eating': 'Healthy Eating',
  'weight management': 'Weight Management',
};

List<String> get allSpecializations => List<String>.unmodifiable(specializations);

String? normalizeSpecialization(dynamic value) {
  if (value == null) return null;
  if (value is List) return null;
  final raw = value.toString().trim();
  if (raw.isEmpty) return null;
  if (specializations.contains(raw)) return raw;
  return aliases[raw.toLowerCase()];
}

List<String> normalizeSpecializationList(dynamic value) {
  if (value == null) return <String>[];
  final rawList = value is List
      ? value
      : value
          .toString()
          .split(',')
          .map((part) => part.trim())
          .where((part) => part.isNotEmpty)
          .toList();
  final seen = <String>{};
  final items = <String>[];
  for (final item in rawList) {
    final normalized = normalizeSpecialization(item);
    if (normalized != null && seen.add(normalized)) {
      items.add(normalized);
    }
  }
  return items;
}

String? validateSpecializationSelection(dynamic value) {
  final list = normalizeSpecializationList(value);
  if (list.isEmpty) return 'Please select at least one specialization.';
  if (list.contains('General Fitness') && list.length > 1) {
    return 'General Fitness cannot be combined with other specializations. Please remove General Fitness before selecting another specialization.';
  }
  return null;
}

/// Returns null when allowed, otherwise an error message.
String? specializationToggleError({
  required Iterable<String> current,
  required String option,
  required bool selecting,
}) {
  final list = normalizeSpecializationList(current.toList());
  final next = normalizeSpecialization(option);
  if (next == null) return 'Invalid specialization: $option';
  if (!selecting) return null;

  if (next == 'General Fitness') {
    if (list.isNotEmpty && !(list.length == 1 && list.first == 'General Fitness')) {
      return 'General Fitness cannot be combined with other specializations. Please remove the other specializations first.';
    }
    return null;
  }

  if (list.contains('General Fitness')) {
    return 'General Fitness cannot be combined with other specializations. Please remove General Fitness before selecting another specialization.';
  }
  return null;
}

List<String> coachSpecializationsFromUser(dynamic user) {
  if (user == null) return <String>[];
  if (user is Map) {
    final fromSpecialties = normalizeSpecializationList(user['coachData']?['specialties']);
    if (fromSpecialties.isNotEmpty) return fromSpecialties;
    final fromProfile = normalizeSpecializationList(user['profile']?['specialization']);
    if (fromProfile.isNotEmpty) return fromProfile;
    return normalizeSpecializationList(
      user['primarySpecialization'] ??
          user['coachData']?['primarySpecialization'] ??
          user['profile']?['primarySpecialization'] ??
          user['specialization'],
    );
  }
  try {
    final profile = user.profile;
    final coachData = user.coachData;
    final fromSpecialties = normalizeSpecializationList(coachData?.specialties);
    if (fromSpecialties.isNotEmpty) return fromSpecialties;
    final fromProfile = normalizeSpecializationList(profile?.specialization);
    if (fromProfile.isNotEmpty) return fromProfile;
    return normalizeSpecializationList(
      user.primarySpecialization ??
          coachData?.primarySpecialization ??
          profile?.primarySpecialization,
    );
  } catch (_) {
    return <String>[];
  }
}

@Deprecated('Use coachSpecializationsFromUser')
String? coachSpecializationFromUser(dynamic user) {
  final list = coachSpecializationsFromUser(user);
  return list.isEmpty ? null : list.first;
}

bool canProvideService(dynamic specializations, String category) {
  final specs = normalizeSpecializationList(specializations);
  final cat = normalizeSpecialization(category);
  if (specs.isEmpty || cat == null) return false;
  if (specs.contains('General Fitness')) return true;
  return specs.contains(cat);
}

List<String> allowedDietGoals(dynamic specializations) {
  final specs = normalizeSpecializationList(specializations);
  if (specs.isEmpty) return <String>[];
  if (specs.contains('General Fitness')) {
    return ['weight_loss', 'muscle_gain', 'maintenance'];
  }
  final goals = <String>[];
  if (specs.any((s) => s == 'Weight Loss' || s == 'Weight Management')) {
    goals.add('weight_loss');
  }
  if (specs.any((s) =>
      s == 'Muscle Building' ||
      s == 'Weight Gain' ||
      s == 'Strength Training' ||
      s == 'Bodybuilding')) {
    goals.add('muscle_gain');
  }
  if (specs.any((s) =>
      s == 'Nutrition' ||
      s == 'Meal Planning' ||
      s == 'Healthy Eating' ||
      s == 'Lifestyle & Wellness')) {
    goals.add('maintenance');
  }
  return goals;
}

List<String> allowedClassCategories(dynamic specializations) {
  final specs = normalizeSpecializationList(specializations);
  if (specs.isEmpty) return <String>[];
  if (specs.contains('General Fitness')) {
    return [
      'General Fitness',
      'Nutrition',
      'Weight Loss',
      'Weight Gain',
      'Muscle Building',
      'Strength Training',
      'Bodybuilding',
      'Cardio & Endurance',
      'HIIT',
      'Functional Training',
      'Yoga & Mindfulness',
      'Flexibility & Mobility',
      'Sports Training',
      'Personal Training',
    ];
  }
  return List<String>.from(specs);
}

bool canAccessWorkouts(dynamic specializations) {
  final specs = normalizeSpecializationList(specializations);
  if (specs.isEmpty) return false;
  if (specs.contains('General Fitness')) return true;
  const dietOnly = {
    'Nutrition',
    'Meal Planning',
    'Healthy Eating',
    'Weight Management',
  };
  return specs.any((s) => !dietOnly.contains(s) || s == 'Weight Loss' || s == 'Weight Gain');
}

bool canAccessDietPlans(dynamic specializations) {
  final specs = normalizeSpecializationList(specializations);
  if (specs.isEmpty) return false;
  if (specs.contains('General Fitness')) return true;
  return specs.any((s) =>
      s == 'Nutrition' ||
      s == 'Meal Planning' ||
      s == 'Healthy Eating' ||
      s == 'Weight Loss' ||
      s == 'Weight Gain' ||
      s == 'Weight Management' ||
      s == 'Lifestyle & Wellness');
}

const fitnessGoalAliases = <String, String>{
  'lose_weight': 'Weight Loss',
  'weight_loss': 'Weight Loss',
  'gain_muscle': 'Muscle Building',
  'muscle_gain': 'Muscle Building',
  'maintain': 'General Fitness',
  'other': 'General Fitness',
  'general': 'General Fitness',
};

/// Fitness goals use the same labels as coach specializations.
List<String> get fitnessGoals => List<String>.from(specializations);

String? normalizeFitnessGoal(dynamic value) {
  if (value == null) return null;
  final raw = value.toString().trim();
  if (raw.isEmpty) return null;
  final lower = raw.toLowerCase();
  if (fitnessGoalAliases.containsKey(lower)) return fitnessGoalAliases[lower];
  return normalizeSpecialization(raw);
}

String fitnessGoalLabel(dynamic goal) => normalizeFitnessGoal(goal) ?? '';

bool coachMatchesFitnessGoal(dynamic coach, dynamic fitnessGoal) {
  final goal = normalizeFitnessGoal(fitnessGoal);
  if (goal == null) return false;
  final specs = coachSpecializationsFromUser(coach);
  return specs.contains(goal);
}
