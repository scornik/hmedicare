// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_api_v1_chambers_id_schedule_rules_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetApiV1ChambersIdScheduleRulesResponse
_$GetApiV1ChambersIdScheduleRulesResponseFromJson(Map<String, dynamic> json) =>
    GetApiV1ChambersIdScheduleRulesResponse(
      data: (json['data'] as List<dynamic>)
          .map((e) => ScheduleRule.fromJson(e as Map<String, dynamic>))
          .toList(),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$GetApiV1ChambersIdScheduleRulesResponseToJson(
  GetApiV1ChambersIdScheduleRulesResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
