// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_serials_id_reschedule_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1SerialsIdRescheduleResponse
_$PostApiV1SerialsIdRescheduleResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1SerialsIdRescheduleResponse(
      data: RescheduleSerialResponse.fromJson(
        json['data'] as Map<String, dynamic>,
      ),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1SerialsIdRescheduleResponseToJson(
  PostApiV1SerialsIdRescheduleResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
