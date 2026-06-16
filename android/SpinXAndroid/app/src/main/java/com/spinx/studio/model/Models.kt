package com.spinx.studio.model

import org.json.JSONObject
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter

data class Session(
    val accessToken: String,
    val refreshToken: String,
    val userId: String,
    val email: String
)

data class Profile(
    val id: String,
    val email: String,
    val firstName: String,
    val lastName: String,
    val mobile: String,
    val emergencyContact: String,
    val role: String,
    val status: String,
    val paymentStatus: String,
    val noShowCount: Int
) {
    val fullName: String
        get() = listOf(firstName, lastName).filter { it.isNotBlank() }.joinToString(" ").ifBlank { email }

    val initials: String
        get() = listOf(firstName, lastName)
            .mapNotNull { it.firstOrNull()?.uppercaseChar()?.toString() }
            .joinToString("")
            .ifBlank { email.firstOrNull()?.uppercaseChar()?.toString() ?: "SX" }

    val canTeach: Boolean get() = role == "admin" || role == "instructor"
    val canManage: Boolean get() = role == "admin"
    val canBook: Boolean get() = role == "member" && status == "active" && paymentStatus == "paid"
}

data class SpinClass(
    val id: String,
    val title: String,
    val startsAt: OffsetDateTime,
    val durationMinutes: Int,
    val instructorId: String?,
    val seriesId: String?,
    val status: String,
    val notes: String?
) {
    val date: LocalDate get() = startsAt.toLocalDate()
}

data class Booking(
    val id: String,
    val classId: String,
    val userId: String,
    val bikeNumber: Int,
    val status: String,
    val createdAt: OffsetDateTime
)

data class WaitlistEntry(
    val id: String,
    val classId: String,
    val userId: String,
    val status: String,
    val createdAt: OffsetDateTime
)

data class Attendance(
    val id: String,
    val classId: String,
    val userId: String,
    val status: String,
    val markedAt: OffsetDateTime
)

data class Payment(
    val id: String,
    val userId: String,
    val dueMonth: String,
    val status: String,
    val confirmedAt: String?
)

data class AppData(
    val classes: List<SpinClass> = emptyList(),
    val bookings: List<Booking> = emptyList(),
    val waitlist: List<WaitlistEntry> = emptyList(),
    val attendance: List<Attendance> = emptyList(),
    val members: List<Profile> = emptyList(),
    val payments: List<Payment> = emptyList()
)

fun JSONObject.string(name: String): String = optString(name, "")
fun JSONObject.nullableString(name: String): String? = if (isNull(name)) null else optString(name)
fun JSONObject.dateTime(name: String): OffsetDateTime =
    OffsetDateTime.parse(optString(name), DateTimeFormatter.ISO_OFFSET_DATE_TIME)

fun JSONObject.toProfile() = Profile(
    id = string("id"),
    email = string("email"),
    firstName = string("first_name"),
    lastName = string("last_name"),
    mobile = string("mobile"),
    emergencyContact = string("emergency_contact"),
    role = string("role"),
    status = string("status"),
    paymentStatus = string("payment_status"),
    noShowCount = optInt("no_show_count", 0)
)

fun JSONObject.toSpinClass() = SpinClass(
    id = string("id"),
    title = string("title"),
    startsAt = dateTime("starts_at"),
    durationMinutes = optInt("duration_minutes", 45),
    instructorId = nullableString("instructor_id"),
    seriesId = nullableString("series_id"),
    status = string("status"),
    notes = nullableString("notes")
)

fun JSONObject.toBooking() = Booking(
    id = string("id"),
    classId = string("class_id"),
    userId = string("user_id"),
    bikeNumber = optInt("bike_number", 0),
    status = string("status"),
    createdAt = dateTime("created_at")
)

fun JSONObject.toWaitlistEntry() = WaitlistEntry(
    id = string("id"),
    classId = string("class_id"),
    userId = string("user_id"),
    status = string("status"),
    createdAt = dateTime("created_at")
)

fun JSONObject.toAttendance() = Attendance(
    id = string("id"),
    classId = string("class_id"),
    userId = string("user_id"),
    status = string("status"),
    markedAt = dateTime("marked_at")
)

fun JSONObject.toPayment() = Payment(
    id = string("id"),
    userId = string("user_id"),
    dueMonth = string("due_month"),
    status = string("status"),
    confirmedAt = nullableString("confirmed_at")
)
