// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_chambers_id_schedule_rules_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1ChambersIdScheduleRulesResponse
_$PostApiV1ChambersIdScheduleRulesResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1ChambersIdScheduleRulesResponse(
      data: ScheduleRule.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1ChambersIdScheduleRulesResponseToJson(
  PostApiV1ChambersIdScheduleRulesResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
