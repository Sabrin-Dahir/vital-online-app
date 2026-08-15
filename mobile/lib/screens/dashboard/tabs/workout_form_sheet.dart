import 'package:flutter/material.dart';
import '../../../services/api_service.dart';
import '../../../utils/workout_media_urls.dart';
import '../widgets/coach_home/coach_dashboard_theme.dart';

class WorkoutExerciseEntry {
  String name;
  int sets;
  int reps;
  int? durationMinutes;
  int? restSeconds;
  String equipment;
  String instructions;
  String demoImageUrl;
  String demoVideoUrl;

  WorkoutExerciseEntry({
    required this.name,
    this.sets = 3,
    this.reps = 10,
    this.durationMinutes,
    this.restSeconds,
    this.equipment = '',
    this.instructions = '',
    this.demoImageUrl = '',
    this.demoVideoUrl = '',
  });

  Map<String, dynamic> toJson() {
    final image = WorkoutMediaUrls.normalize(demoImageUrl) ?? '';
    final video = WorkoutMediaUrls.normalize(demoVideoUrl) ?? '';
    return {
      'name': name,
      'sets': sets,
      'reps': reps,
      if (durationMinutes != null) 'durationMinutes': durationMinutes,
      if (restSeconds != null) 'restSeconds': restSeconds,
      if (equipment.isNotEmpty) 'equipment': equipment,
      if (instructions.isNotEmpty) 'instructions': instructions,
      if (image.isNotEmpty) 'demoImageUrl': image,
      if (video.isNotEmpty) 'demoVideoUrl': video,
    };
  }

  factory WorkoutExerciseEntry.fromMap(Map<String, dynamic> map) => WorkoutExerciseEntry(
        name: map['name']?.toString() ?? '',
        sets: map['sets'] as int? ?? 3,
        reps: map['reps'] as int? ?? 10,
        durationMinutes: map['durationMinutes'] as int?,
        restSeconds: map['restSeconds'] as int?,
        equipment: map['equipment']?.toString() ?? '',
        instructions: map['instructions']?.toString() ?? '',
        demoImageUrl: map['demoImageUrl']?.toString() ?? '',
        demoVideoUrl: map['demoVideoUrl']?.toString() ?? '',
      );
}

class WorkoutFormSheet extends StatefulWidget {
  final String targetLabel;
  final String? clientId;
  final String? fitnessClassId;
  final Map<String, dynamic>? existingPlan;
  final ApiService apiService;
  final VoidCallback onSaved;

  const WorkoutFormSheet({
    super.key,
    required this.targetLabel,
    this.clientId,
    this.fitnessClassId,
    this.existingPlan,
    required this.apiService,
    required this.onSaved,
  });

  @override
  State<WorkoutFormSheet> createState() => _WorkoutFormSheetState();
}

class _WorkoutFormSheetState extends State<WorkoutFormSheet> {
  final _titleController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _instructionsController = TextEditingController();
  final _customExerciseController = TextEditingController();

  bool _isSubmitting = false;
  bool _libraryLoading = true;
  String _level = 'Beginner';
  List<dynamic> _exerciseLibrary = [];
  final Set<String> _selectedLibrary = {};
  final List<WorkoutExerciseEntry> _exercises = [];

  bool get _isEditing => widget.existingPlan != null;

  @override
  void initState() {
    super.initState();
    _loadLibrary();
    if (_isEditing) {
      final plan = widget.existingPlan!;
      _titleController.text = plan['title']?.toString() ?? '';
      _descriptionController.text = plan['description']?.toString() ?? '';
      _instructionsController.text = plan['instructions']?.toString() ?? plan['notes']?.toString() ?? '';
      _level = plan['level']?.toString() ?? 'Beginner';
      final items = plan['exercises'] as List<dynamic>? ?? [];
      _exercises.addAll(items.map((e) => WorkoutExerciseEntry.fromMap(Map<String, dynamic>.from(e as Map))));
    }
  }

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    _instructionsController.dispose();
    _customExerciseController.dispose();
    super.dispose();
  }

  Future<void> _loadLibrary() async {
    setState(() => _libraryLoading = true);
    try {
      final lib = await widget.apiService.getExerciseLibrary();
      if (mounted) setState(() => _exerciseLibrary = lib);
    } catch (_) {
      if (mounted) setState(() => _exerciseLibrary = []);
    } finally {
      if (mounted) setState(() => _libraryLoading = false);
    }
  }

  void _addFromLibrary(String name) {
    if (_exercises.any((e) => e.name == name)) return;
    setState(() => _exercises.add(WorkoutExerciseEntry(name: name)));
  }

  void _addCustomExercises() {
    final names = _customExerciseController.text
        .split(',')
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty);
    for (final name in names) {
      if (!_exercises.any((e) => e.name == name)) {
        _exercises.add(WorkoutExerciseEntry(name: name));
      }
    }
    _customExerciseController.clear();
    setState(() {});
  }

  Future<void> _submit() async {
    if (_exercises.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Add at least one exercise'), backgroundColor: CoachDashboardTheme.danger),
      );
      return;
    }
    for (var i = 0; i < _exercises.length; i++) {
      final exercise = _exercises[i];
      if (exercise.name.trim().isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Exercise ${i + 1}: name is required'),
            backgroundColor: CoachDashboardTheme.danger,
          ),
        );
        return;
      }
      if (exercise.sets < 1 || exercise.sets > 100) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Exercise ${i + 1}: sets must be between 1 and 100'),
            backgroundColor: CoachDashboardTheme.danger,
          ),
        );
        return;
      }
      if (exercise.reps < 1 || exercise.reps > 500) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Exercise ${i + 1}: repetitions must be between 1 and 500'),
            backgroundColor: CoachDashboardTheme.danger,
          ),
        );
        return;
      }
    }

    setState(() => _isSubmitting = true);
    final isTemplate = widget.clientId == null && widget.fitnessClassId == null;
    final payload = <String, dynamic>{
      'title': _titleController.text.trim().isEmpty ? 'Workout Plan' : _titleController.text.trim(),
      'description': _descriptionController.text.trim(),
      'level': _level,
      'exercises': _exercises.map((e) => e.toJson()).toList(),
    };
    if (isTemplate) {
      payload['notes'] = _instructionsController.text.trim();
    } else {
      payload['instructions'] = _instructionsController.text.trim();
    }

    try {
      if (isTemplate) {
        if (_isEditing) {
          await widget.apiService.updateWorkoutTemplate(widget.existingPlan!['_id'].toString(), payload);
        } else {
          await widget.apiService.createWorkoutTemplate(payload);
        }
      } else if (_isEditing) {
        await widget.apiService.updateExercisePlan(widget.existingPlan!['_id'].toString(), payload);
      } else {
        if (widget.clientId != null) payload['clientId'] = widget.clientId!;
        if (widget.fitnessClassId != null) payload['fitnessClassId'] = widget.fitnessClassId!;
        await widget.apiService.createExercisePlan(payload);
      }
      if (mounted) {
        setState(() => _isSubmitting = false);
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_isEditing ? 'Workout updated!' : 'Workout assigned!'),
            backgroundColor: CoachDashboardTheme.success,
          ),
        );
        // Refresh parent list after the sheet closes — don't hold Save spinner.
        widget.onSaved();
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isSubmitting = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiService.friendlyError(e)), backgroundColor: CoachDashboardTheme.danger),
        );
      }
    } finally {
      if (mounted && _isSubmitting) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.92),
        decoration: BoxDecoration(
          color: isDark ? const Color(0xFF181B24) : Colors.white,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 20, 16, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '${_isEditing ? 'Edit' : 'Create'} workout — ${widget.targetLabel}',
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                    ),
                  ),
                  IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(context)),
                ],
              ),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Workout title', style: CoachDashboardTheme.sectionTitle(isDark)),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _titleController,
                      decoration: CoachDashboardTheme.fieldDecoration(isDark: isDark, label: 'Title', hint: 'Upper Body Strength'),
                    ),
                    const SizedBox(height: 16),
                    Text('Description', style: CoachDashboardTheme.sectionTitle(isDark)),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _descriptionController,
                      maxLines: 2,
                      decoration: CoachDashboardTheme.fieldDecoration(isDark: isDark, label: 'Description', hint: 'Focus on form and controlled reps'),
                    ),
                    const SizedBox(height: 16),
                    Text('Instructions', style: CoachDashboardTheme.sectionTitle(isDark)),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _instructionsController,
                      maxLines: 2,
                      decoration: CoachDashboardTheme.fieldDecoration(isDark: isDark, label: 'General instructions', hint: 'Warm up 5 min before starting'),
                    ),
                    const SizedBox(height: 16),
                    Text('Difficulty', style: CoachDashboardTheme.sectionTitle(isDark)),
                    const SizedBox(height: 8),
                    DropdownButtonFormField<String>(
                      initialValue: _level,
                      decoration: CoachDashboardTheme.fieldDecoration(isDark: isDark, label: 'Level'),
                      items: const [
                        DropdownMenuItem(value: 'Beginner', child: Text('Beginner')),
                        DropdownMenuItem(value: 'Intermediate', child: Text('Intermediate')),
                        DropdownMenuItem(value: 'Advanced', child: Text('Advanced')),
                      ],
                      onChanged: (v) => setState(() => _level = v ?? 'Beginner'),
                    ),
                    const SizedBox(height: 20),
                    Text('Exercise library', style: CoachDashboardTheme.sectionTitle(isDark)),
                    const SizedBox(height: 8),
                    if (_exerciseLibrary.isEmpty)
                      Text('No library exercises yet — add custom ones below.', style: TextStyle(color: isDark ? Colors.white54 : Colors.grey))
                    else
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: _exerciseLibrary.map((ex) {
                          final name = ex['name']?.toString() ?? '';
                          final selected = _selectedLibrary.contains(name);
                          return FilterChip(
                            label: Text(name),
                            selected: selected,
                            onSelected: (val) {
                              setState(() {
                                if (val) {
                                  _selectedLibrary.add(name);
                                  _addFromLibrary(name);
                                } else {
                                  _selectedLibrary.remove(name);
                                  _exercises.removeWhere((e) => e.name == name);
                                }
                              });
                            },
                            selectedColor: CoachDashboardTheme.primary.withValues(alpha: 0.15),
                            checkmarkColor: CoachDashboardTheme.primary,
                          );
                        }).toList(),
                      ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _customExerciseController,
                            decoration: CoachDashboardTheme.fieldDecoration(
                              isDark: isDark,
                              label: 'Custom exercises',
                              hint: 'Burpees, Lunges...',
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        IconButton.filled(
                          onPressed: _addCustomExercises,
                          icon: const Icon(Icons.add),
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),
                    Text('Exercises (${_exercises.length})', style: CoachDashboardTheme.sectionTitle(isDark)),
                    const SizedBox(height: 8),
                    if (_exercises.isEmpty)
                      Text('No exercises added yet.', style: TextStyle(color: isDark ? Colors.white54 : Colors.grey))
                    else
                      ..._exercises.asMap().entries.map((entry) => _ExerciseEditorCard(
                            index: entry.key,
                            entry: entry.value,
                            isDark: isDark,
                            onChanged: () => setState(() {}),
                            onRemove: () => setState(() => _exercises.removeAt(entry.key)),
                          )),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
              child: SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton(
                  style: CoachDashboardTheme.primaryButtonStyle(),
                  onPressed: _isSubmitting ? null : _submit,
                  child: Text(_isEditing ? 'Save Changes' : 'Assign Workout'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ExerciseEditorCard extends StatelessWidget {
  final int index;
  final WorkoutExerciseEntry entry;
  final bool isDark;
  final VoidCallback onChanged;
  final VoidCallback onRemove;

  const _ExerciseEditorCard({
    required this.index,
    required this.entry,
    required this.isDark,
    required this.onChanged,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: isDark ? Colors.white12 : Colors.grey.shade300),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(entry.name, style: const TextStyle(fontWeight: FontWeight.w700))),
              IconButton(icon: const Icon(Icons.delete_outline, size: 20, color: CoachDashboardTheme.danger), onPressed: onRemove),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(child: _numField('Sets', entry.sets, (v) { entry.sets = v; onChanged(); }, isDark)),
              const SizedBox(width: 8),
              Expanded(child: _numField('Reps', entry.reps, (v) { entry.reps = v; onChanged(); }, isDark)),
              const SizedBox(width: 8),
              Expanded(child: _numField('Duration (min)', entry.durationMinutes ?? 0, (v) { entry.durationMinutes = v > 0 ? v : null; onChanged(); }, isDark)),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(child: _numField('Rest (sec)', entry.restSeconds ?? 0, (v) { entry.restSeconds = v > 0 ? v : null; onChanged(); }, isDark)),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  decoration: CoachDashboardTheme.fieldDecoration(isDark: isDark, label: 'Equipment', hint: 'Dumbbells'),
                  controller: TextEditingController(text: entry.equipment)
                    ..selection = TextSelection.collapsed(offset: entry.equipment.length),
                  onChanged: (v) { entry.equipment = v; onChanged(); },
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          TextField(
            decoration: CoachDashboardTheme.fieldDecoration(isDark: isDark, label: 'Instructions'),
            maxLines: 2,
            controller: TextEditingController(text: entry.instructions)
              ..selection = TextSelection.collapsed(offset: entry.instructions.length),
            onChanged: (v) { entry.instructions = v; onChanged(); },
          ),
          const SizedBox(height: 8),
          TextField(
            decoration: CoachDashboardTheme.fieldDecoration(isDark: isDark, label: 'Demo image URL'),
            controller: TextEditingController(text: entry.demoImageUrl)
              ..selection = TextSelection.collapsed(offset: entry.demoImageUrl.length),
            onChanged: (v) { entry.demoImageUrl = v; onChanged(); },
          ),
          const SizedBox(height: 8),
          TextField(
            decoration: CoachDashboardTheme.fieldDecoration(
              isDark: isDark,
              label: 'Demo video URL (YouTube / Vimeo / https…)',
            ),
            keyboardType: TextInputType.url,
            controller: TextEditingController(text: entry.demoVideoUrl)
              ..selection = TextSelection.collapsed(offset: entry.demoVideoUrl.length),
            onChanged: (v) { entry.demoVideoUrl = v; onChanged(); },
          ),
        ],
      ),
    );
  }

  Widget _numField(String label, int value, ValueChanged<int> onChanged, bool isDark) {
    return TextField(
      decoration: CoachDashboardTheme.fieldDecoration(isDark: isDark, label: label),
      keyboardType: TextInputType.number,
      controller: TextEditingController(text: value > 0 ? '$value' : '')
        ..selection = TextSelection.collapsed(offset: value > 0 ? '$value'.length : 0),
      onChanged: (v) => onChanged(int.tryParse(v) ?? 0),
    );
  }
}
