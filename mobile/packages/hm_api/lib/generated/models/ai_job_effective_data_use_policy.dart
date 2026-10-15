// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

/// Shown beside every suggestion this job produced
@JsonEnum()
enum AiJobEffectiveDataUsePolicy {
  @JsonValue('MAY_TRAIN_OR_REVIEW')
  mayTrainOrReview('MAY_TRAIN_OR_REVIEW'),
  @JsonValue('NO_TRAINING_CONTRACTUAL')
  noTrainingContractual('NO_TRAINING_CONTRACTUAL'),
  /// Default value for all unparsed values, allows backward compatibility when adding new values on the backend.
  $unknown(null);

  const AiJobEffectiveDataUsePolicy(this.json);

  factory AiJobEffectiveDataUsePolicy.fromJson(String json) => values.firstWhere(
        (e) => e.json == json,
        orElse: () => $unknown,
      );

  final String? json;
  String toJson() {
    final value = json;
    if (value == null) {
      throw StateError('Cannot convert enum value with null JSON representation to String. '
          'This usually happens for \$unknown or @JsonValue(null) entries.');
    }
    return value as String;
  }

  @override
  String toString() => json?.toString() ?? super.toString();
  /// Returns all defined enum values excluding the $unknown value.
  static List<AiJobEffectiveDataUsePolicy> get $valuesDefined => values.where((value) => value != $unknown).toList();
}
