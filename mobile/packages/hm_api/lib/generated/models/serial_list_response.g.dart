// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'serial_list_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SerialListResponse _$SerialListResponseFromJson(Map<String, dynamic> json) =>
    SerialListResponse(
      items: (json['items'] as List<dynamic>)
          .map((e) => PatientSerialView.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$SerialListResponseToJson(SerialListResponse instance) =>
    <String, dynamic>{'items': instance.items};
