// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'me_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MeResponse _$MeResponseFromJson(Map<String, dynamic> json) => MeResponse(
  memberships: (json['memberships'] as List<dynamic>)
      .map((e) => MembershipSummary.fromJson(e as Map<String, dynamic>))
      .toList(),
  platformOperator: json['platformOperator'] as bool,
  user: MeUser.fromJson(json['user'] as Map<String, dynamic>),
);

Map<String, dynamic> _$MeResponseToJson(MeResponse instance) =>
    <String, dynamic>{
      'memberships': instance.memberships,
      'platformOperator': instance.platformOperator,
      'user': instance.user,
    };
