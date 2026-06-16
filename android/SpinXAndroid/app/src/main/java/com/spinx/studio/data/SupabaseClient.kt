package com.spinx.studio.data

import com.spinx.studio.BuildConfig
import com.spinx.studio.model.AppData
import com.spinx.studio.model.Profile
import com.spinx.studio.model.Session
import com.spinx.studio.model.toAttendance
import com.spinx.studio.model.toBooking
import com.spinx.studio.model.toPayment
import com.spinx.studio.model.toProfile
import com.spinx.studio.model.toSpinClass
import com.spinx.studio.model.toWaitlistEntry
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

class SpinXApi {
    private val client = OkHttpClient()
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val baseUrl = BuildConfig.SUPABASE_URL.trimEnd('/')
    private val anonKey = BuildConfig.SUPABASE_ANON_KEY

    fun signIn(email: String, password: String): Session {
        val body = JSONObject()
            .put("email", email.trim())
            .put("password", password)
        val json = request(
            method = "POST",
            url = "$baseUrl/auth/v1/token?grant_type=password",
            body = body.toBody(),
            accessToken = null
        ).asObject()
        val user = json.getJSONObject("user")
        return Session(
            accessToken = json.getString("access_token"),
            refreshToken = json.optString("refresh_token", ""),
            userId = user.getString("id"),
            email = user.optString("email", email.trim())
        )
    }

    fun signUp(
        firstName: String,
        lastName: String,
        mobile: String,
        emergencyContact: String,
        email: String,
        password: String,
        signature: String
    ) {
        val metadata = JSONObject()
            .put("first_name", firstName.trim())
            .put("last_name", lastName.trim())
            .put("mobile", mobile.trim())
            .put("emergency_contact", emergencyContact.trim())
            .put("signature_text", signature.trim())
        val body = JSONObject()
            .put("email", email.trim())
            .put("password", password)
            .put("data", metadata)
        request(
            method = "POST",
            url = "$baseUrl/auth/v1/signup",
            body = body.toBody(),
            accessToken = null
        )
    }

    fun fetchProfile(session: Session): Profile {
        val path = "spinx_profiles?select=*&id=eq.${session.userId}"
        val array = restGet(path, session.accessToken).asArray()
        if (array.length() == 0) error("Profile not found. Ask an admin to check this account.")
        return array.getJSONObject(0).toProfile()
    }

    fun fetchAppData(profile: Profile, accessToken: String): AppData {
        val classes = restGet("spinx_classes?select=*&order=starts_at.asc", accessToken)
            .asArray()
            .mapObjects { it.toSpinClass() }
        val bookings = restGet("spinx_bookings?select=*&order=created_at.desc", accessToken)
            .asArray()
            .mapObjects { it.toBooking() }
        val waitlist = restGet("spinx_waitlist?select=*&order=created_at.asc", accessToken)
            .asArray()
            .mapObjects { it.toWaitlistEntry() }
        val attendance = restGet("spinx_attendance?select=*&order=marked_at.desc", accessToken)
            .asArray()
            .mapObjects { it.toAttendance() }
        val members = if (profile.canTeach) {
            restGet("spinx_profiles?select=*&order=created_at.desc", accessToken).asArray().mapObjects { it.toProfile() }
        } else {
            listOf(profile)
        }
        val payments = if (profile.canManage) {
            restGet("spinx_payments?select=*&order=due_month.desc", accessToken).asArray().mapObjects { it.toPayment() }
        } else {
            emptyList()
        }
        return AppData(classes, bookings, waitlist, attendance, members, payments)
    }

    fun bookNextBike(classId: String, accessToken: String) =
        rpc("spinx_book_next_bike", JSONObject().put("p_class_id", classId), accessToken)

    fun joinWaitlist(classId: String, accessToken: String) =
        rpc("spinx_join_waitlist", JSONObject().put("p_class_id", classId), accessToken)

    fun cancelBooking(bookingId: String, accessToken: String) =
        rpc("spinx_cancel_booking", JSONObject().put("p_booking_id", bookingId), accessToken)

    fun adminBookMember(classId: String, userId: String, accessToken: String) =
        rpc("spinx_admin_book_member", JSONObject().put("p_class_id", classId).put("p_user_id", userId), accessToken)

    fun approveMember(userId: String, accessToken: String) =
        rpc("spinx_approve_member", JSONObject().put("p_user_id", userId), accessToken)

    fun declineMember(userId: String, accessToken: String) =
        rpc("spinx_decline_member", JSONObject().put("p_user_id", userId), accessToken)

    fun markAttendance(classId: String, userId: String, status: String, accessToken: String) =
        rpc(
            "spinx_mark_attendance",
            JSONObject().put("p_class_id", classId).put("p_user_id", userId).put("p_status", status),
            accessToken
        )

    fun updateMyProfile(firstName: String, lastName: String, mobile: String, emergencyContact: String, accessToken: String) =
        rpc(
            "spinx_update_my_profile",
            JSONObject()
                .put("p_first_name", firstName.trim())
                .put("p_last_name", lastName.trim())
                .put("p_mobile", mobile.trim())
                .put("p_emergency_contact", emergencyContact.trim()),
            accessToken
        )

    fun updateMember(userId: String, patch: JSONObject, accessToken: String) =
        restPatch("spinx_profiles?id=eq.$userId", patch, accessToken)

    fun createClasses(rows: JSONArray, accessToken: String) =
        restPost("spinx_classes", rows.toString().toRequestBody(jsonType), accessToken)

    fun updateClass(classId: String, patch: JSONObject, accessToken: String) =
        restPatch("spinx_classes?id=eq.$classId", patch, accessToken)

    fun updateClasses(ids: List<String>, patch: JSONObject, accessToken: String) {
        if (ids.isEmpty()) return
        val filter = ids.joinToString(",")
        restPatch("spinx_classes?id=in.($filter)", patch, accessToken)
    }

    fun signOut(accessToken: String) {
        request("POST", "$baseUrl/auth/v1/logout", "{}".toRequestBody(jsonType), accessToken)
    }

    private fun rpc(name: String, payload: JSONObject, accessToken: String) =
        request("POST", "$baseUrl/rest/v1/rpc/$name", payload.toBody(), accessToken)

    private fun restGet(path: String, accessToken: String): String =
        request("GET", "$baseUrl/rest/v1/$path", null, accessToken)

    private fun restPost(path: String, body: RequestBody, accessToken: String): String =
        request("POST", "$baseUrl/rest/v1/$path", body, accessToken)

    private fun restPatch(path: String, payload: JSONObject, accessToken: String): String =
        request("PATCH", "$baseUrl/rest/v1/$path", payload.toBody(), accessToken)

    private fun request(method: String, url: String, body: RequestBody?, accessToken: String?): String {
        val builder = Request.Builder()
            .url(url)
            .header("apikey", anonKey)
            .header("Accept", "application/json")
        if (accessToken != null) builder.header("Authorization", "Bearer $accessToken")
        if (method == "POST" || method == "PATCH") builder.header("Prefer", "return=representation")
        val request = when (method) {
            "GET" -> builder.get()
            "POST" -> builder.post(body ?: "{}".toRequestBody(jsonType))
            "PATCH" -> builder.patch(body ?: "{}".toRequestBody(jsonType))
            else -> error("Unsupported HTTP method $method")
        }.build()

        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val message = runCatching { JSONObject(text).optString("message") }.getOrNull()
                    ?: runCatching { JSONObject(text).optString("error_description") }.getOrNull()
                    ?: response.message
                error(message.ifBlank { "Supabase request failed (${response.code})" })
            }
            return text
        }
    }

    private fun JSONObject.toBody() = toString().toRequestBody(jsonType)
}

fun String.asObject(): JSONObject = JSONObject(ifBlank { "{}" })
fun String.asArray(): JSONArray = JSONArray(ifBlank { "[]" })

fun <T> JSONArray.mapObjects(transform: (JSONObject) -> T): List<T> {
    val result = mutableListOf<T>()
    for (index in 0 until length()) result += transform(getJSONObject(index))
    return result
}

fun queryEncode(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8.name())
