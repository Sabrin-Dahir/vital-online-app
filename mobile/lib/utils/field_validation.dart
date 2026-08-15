/// Shared field validators aligned with backend/src/utils/fieldValidation.js

final RegExp emailRe = RegExp(
  r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$',
);
final RegExp fullNameRe = RegExp(r'^[\p{L}]+(?:\s+[\p{L}]+)*$', unicode: true);
final RegExp phoneRe = RegExp(r'^\+?[0-9][0-9\s\-()]{6,18}$');
final RegExp digitsOnlyRe = RegExp(r'^\d+$');
final RegExp hasDigitRe = RegExp(r'\d');

String? validateEmail(String? value) {
  final email = (value ?? '').trim().toLowerCase();
  if (email.isEmpty) return 'Email is required';
  if (digitsOnlyRe.hasMatch(email) ||
      !emailRe.hasMatch(email) ||
      email.length < 5) {
    return 'Please enter a valid email address';
  }
  return null;
}

String? validateFullName(String? value) {
  final name = (value ?? '').trim();
  if (name.isEmpty) return 'Full name is required';
  if (name.length > 80) return 'Full name is too long';
  if (hasDigitRe.hasMatch(name) || !fullNameRe.hasMatch(name)) {
    return 'Full name can only contain letters and spaces.';
  }
  if (name.length < 2) return 'Full name is too short';
  return null;
}

String? validatePhone(String? value, {bool required = false}) {
  final phone = (value ?? '').trim();
  if (phone.isEmpty) return required ? 'Phone number is required' : null;
  final digits = phone.replaceAll(RegExp(r'\D'), '');
  if (!phoneRe.hasMatch(phone) || digits.length < 7 || digits.length > 15) {
    return 'Please enter a valid phone number';
  }
  return null;
}

String? validateHeight(String? value, {bool required = false}) {
  final raw = (value ?? '').trim();
  if (raw.isEmpty) {
    return required ? 'Height must be between 50 cm and 250 cm.' : null;
  }
  final parsed = num.tryParse(raw);
  if (parsed == null || parsed < 50 || parsed > 250) {
    return 'Height must be between 50 cm and 250 cm.';
  }
  return null;
}

String? validateWeight(String? value, {bool required = false}) {
  final raw = (value ?? '').trim();
  if (raw.isEmpty) {
    return required ? 'Weight must be between 20 kg and 300 kg.' : null;
  }
  final parsed = num.tryParse(raw);
  if (parsed == null || parsed < 20 || parsed > 300) {
    return 'Weight must be between 20 kg and 300 kg.';
  }
  return null;
}

String? validateAge(String? value, {bool required = false}) {
  final raw = (value ?? '').trim();
  if (raw.isEmpty) {
    return required ? 'Age must be between 18 and 120 years.' : null;
  }
  if (!RegExp(r'^-?\d+$').hasMatch(raw)) {
    return 'Age must be between 18 and 120 years.';
  }
  final parsed = int.tryParse(raw);
  if (parsed == null || parsed < 18 || parsed > 120) {
    return 'Age must be between 18 and 120 years.';
  }
  return null;
}

double? calcBmi(num? heightCm, num? weightKg) {
  final height = heightCm?.toDouble();
  final weight = weightKg?.toDouble();
  if (height == null || weight == null) return null;
  if (height < 50 || height > 250 || weight < 20 || weight > 300) return null;
  final meters = height / 100;
  if (meters <= 0) return null;
  return double.parse((weight / (meters * meters)).toStringAsFixed(1));
}

String? bmiCategory(num? bmi) {
  if (bmi == null) return null;
  final value = bmi.toDouble();
  if (value < 18.5) return 'Underweight';
  if (value < 25) return 'Normal weight';
  if (value < 30) return 'Overweight';
  return 'Obesity';
}

String? validateOptionalNumber(
  String? value,
  String label, {
  num? min,
  num? max,
}) {
  final raw = (value ?? '').trim();
  if (raw.isEmpty) return null;
  final parsed = num.tryParse(raw);
  if (parsed == null) return '$label must be a number';
  if (min != null && parsed < min) return '$label must be at least $min';
  if (max != null && parsed > max) return '$label must be at most $max';
  return null;
}

String? validateRequiredNumber(
  String? value,
  String label, {
  num? min,
  num? max,
}) {
  final raw = (value ?? '').trim();
  if (raw.isEmpty) return '$label is required';
  return validateOptionalNumber(value, label, min: min, max: max);
}
