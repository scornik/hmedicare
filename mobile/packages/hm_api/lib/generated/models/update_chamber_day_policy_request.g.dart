// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'update_chamber_day_policy_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

UpdateChamberDayPolicyRequest _$UpdateChamberDayPolicyRequestFromJson(
  Map<String, dynamic> json,
) => UpdateChamberDayPolicyRequest(
  expectedQueueOrderVersion: (json['expectedQueueOrderVersion'] as num).toInt(),
  policy: QueuePolicyPatch.fromJson(json['policy'] as Map<String, dynamic>),
);

Map<String, dynamic> _$UpdateChamberDayPolicyRequestToJson(
  UpdateChamberDayPolicyRequest instance,
) => <String, dynamic>{
  'expectedQueueOrderVersion': instance.expectedQueueOrderVersion,
  'policy': instance.policy,
};
