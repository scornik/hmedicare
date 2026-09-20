// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_schedule_rules_id_end_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1ScheduleRulesIdEndResponse
_$PostApiV1ScheduleRulesIdEndResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1ScheduleRulesIdEndResponse(
      data: ScheduleRule.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1ScheduleRulesIdEndResponseToJson(
  PostApiV1ScheduleRulesIdEndResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
