// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'record_delay_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

RecordDelayRequest _$RecordDelayRequestFromJson(Map<String, dynamic> json) =>
    RecordDelayRequest(
      delayMinutes: (json['delayMinutes'] as num).toInt(),
      expectedQueueOrderVersion: (json['expectedQueueOrderVersion'] as num)
          .toInt(),
      reasonCode: RecordDelayRequestReasonCode.fromJson(
        json['reasonCode'] as String,
      ),
    );

Map<String, dynamic> _$RecordDelayRequestToJson(RecordDelayRequest instance) =>
    <String, dynamic>{
      'delayMinutes': instance.delayMinutes,
      'expectedQueueOrderVersion': instance.expectedQueueOrderVersion,
      'reasonCode': instance.reasonCode,
    };
