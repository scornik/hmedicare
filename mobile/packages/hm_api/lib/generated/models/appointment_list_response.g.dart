// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'appointment_list_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AppointmentListResponse _$AppointmentListResponseFromJson(
  Map<String, dynamic> json,
) => AppointmentListResponse(
  hasMore: json['hasMore'] as bool,
  items: (json['items'] as List<dynamic>)
      .map((e) => Appointment.fromJson(e as Map<String, dynamic>))
      .toList(),
  nextCursor: json['nextCursor'] as String?,
);

Map<String, dynamic> _$AppointmentListResponseToJson(
  AppointmentListResponse instance,
) => <String, dynamic>{
  'hasMore': instance.hasMore,
  'items': instance.items,
  'nextCursor': ?instance.nextCursor,
};
