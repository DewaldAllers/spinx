package com.spinx.studio

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import com.spinx.studio.data.SpinXApi
import com.spinx.studio.model.AppData
import com.spinx.studio.model.Booking
import com.spinx.studio.model.Profile
import com.spinx.studio.model.Session
import com.spinx.studio.model.SpinClass
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.math.max

class MainActivity : Activity() {
    private val api = SpinXApi()
    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("spinx-session", Context.MODE_PRIVATE) }

    private var session: Session? = null
    private var profile: Profile? = null
    private var data: AppData = AppData()
    private var tab = "dashboard"
    private var selectedDate: LocalDate = LocalDate.now()
    private var calendarMonth: YearMonth = YearMonth.now()
    private var selectedBookingClassId: String? = null
    private var message: String = ""
    private var error: String = ""

    private val brand = Color.rgb(15, 90, 72)
    private val brandDark = Color.rgb(2, 9, 7)
    private val bg = Color.rgb(238, 244, 242)
    private val panel = Color.WHITE
    private val muted = Color.rgb(104, 115, 134)
    private val line = Color.rgb(216, 222, 214)
    private val danger = Color.rgb(180, 35, 24)
    private val accent = Color.rgb(0, 217, 255)
    private val lime = Color.rgb(223, 255, 0)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        session = restoreSession()
        if (session == null) {
            renderAuth()
        } else {
            renderLoading("Loading SpinX...")
            loadAll()
        }
    }

    private fun restoreSession(): Session? {
        val token = prefs.getString("access_token", null) ?: return null
        val userId = prefs.getString("user_id", "") ?: ""
        val email = prefs.getString("email", "") ?: ""
        val refresh = prefs.getString("refresh_token", "") ?: ""
        if (userId.isBlank()) return null
        return Session(token, refresh, userId, email)
    }

    private fun saveSession(value: Session) {
        prefs.edit()
            .putString("access_token", value.accessToken)
            .putString("refresh_token", value.refreshToken)
            .putString("user_id", value.userId)
            .putString("email", value.email)
            .apply()
    }

    private fun clearSession() {
        prefs.edit().clear().apply()
        session = null
        profile = null
        data = AppData()
    }

    private fun loadAll() {
        val activeSession = session ?: return renderAuth()
        background(
            work = {
                val freshProfile = api.fetchProfile(activeSession)
                val freshData = api.fetchAppData(freshProfile, activeSession.accessToken)
                freshProfile to freshData
            },
            success = { result ->
                profile = result.first
                data = result.second
                if (tab !in tabsFor(result.first)) tab = "dashboard"
                renderApp()
            },
            failure = { throwable ->
                clearSession()
                error = throwable.message.orEmpty()
                renderAuth()
            }
        )
    }

    private fun <T> background(work: () -> T, success: (T) -> Unit, failure: (Throwable) -> Unit = { showError(it.message.orEmpty()) }) {
        executor.execute {
            try {
                val value = work()
                main.post { success(value) }
            } catch (throwable: Throwable) {
                main.post { failure(throwable) }
            }
        }
    }

    private fun runApi(successMessage: String, work: () -> Unit) {
        renderLoading("Saving...")
        background(
            work = {
                work()
                true
            },
            success = {
                message = successMessage
                error = ""
                loadAll()
            },
            failure = {
                error = it.message.orEmpty()
                message = ""
                loadAll()
            }
        )
    }

    private fun renderAuth() {
        val root = ScrollView(this)
        root.setBackgroundColor(bg)
        val shell = LinearLayout(this).vertical().pad(18)
        root.addView(shell)

        val hero = card().apply {
            background = rounded(brandDark, 0, 0, 18)
            setPadding(dp(22), dp(28), dp(22), dp(28))
        }
        hero.addView(ImageView(this).apply {
            setImageResource(resources.getIdentifier("spinx_logo", "drawable", packageName))
            adjustViewBounds = true
            layoutParams = LinearLayout.LayoutParams(dp(140), dp(70))
        })
        hero.addView(text("SpinX Studio", 34, Color.WHITE, true).marginTop(18))
        hero.addView(text("pedal.connect.belong", 17, Color.WHITE, false).marginTop(6))
        hero.addView(text("New members register here and wait for admin approval before booking bikes.", 16, Color.WHITE, false).marginTop(18))
        shell.addView(hero)

        if (message.isNotBlank()) shell.addView(alert(message, false))
        if (error.isNotBlank()) shell.addView(alert(cleanAuthError(error), true))

        val loginCard = card()
        loginCard.layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(14) }
        loginCard.addView(text("Log in", 26, brandDark, true))
        val email = field("Email")
        val password = field("Password").apply { inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD }
        loginCard.addView(email)
        loginCard.addView(password)
        loginCard.addView(primaryButton("Log in") {
            val emailValue = email.text.toString().trim()
            val passwordValue = password.text.toString()
            if (emailValue.isBlank() || passwordValue.isBlank()) return@primaryButton showError("Enter email and password.")
            renderLoading("Signing in...")
            background(
                work = { api.signIn(emailValue, passwordValue) },
                success = {
                    saveSession(it)
                    session = it
                    message = ""
                    error = ""
                    loadAll()
                },
                failure = {
                    error = cleanAuthError(it.message.orEmpty())
                    renderAuth()
                }
            )
        }.marginTop(8))
        shell.addView(loginCard)

        val registerCard = card()
        registerCard.layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(14) }
        registerCard.addView(text("Register", 26, brandDark, true))
        val firstName = field("First name")
        val lastName = field("Last name")
        val mobile = field("Mobile number")
        val emergency = field("Emergency contact")
        val registerEmail = field("Email")
        val registerPassword = field("Password").apply { inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD }
        val signature = field("Type your full name as your signature", minLines = 3)
        listOf(firstName, lastName, mobile, emergency, registerEmail, registerPassword, signature).forEach { registerCard.addView(it) }
        registerCard.addView(text("By registering, you accept the SpinX membership agreement and agree that an admin must approve your account before booking.", 14, muted, false).marginTop(8))
        registerCard.addView(primaryButton("Create account") {
            if (registerEmail.text.isBlank() || registerPassword.text.isBlank() || firstName.text.isBlank() || lastName.text.isBlank() || signature.text.isBlank()) {
                return@primaryButton showError("Complete name, email, password, and signature.")
            }
            renderLoading("Creating account...")
            background(
                work = {
                    api.signUp(
                        firstName.text.toString(),
                        lastName.text.toString(),
                        mobile.text.toString(),
                        emergency.text.toString(),
                        registerEmail.text.toString(),
                        registerPassword.text.toString(),
                        signature.text.toString()
                    )
                },
                success = {
                    message = "Account created. An admin must approve it before booking is enabled."
                    error = ""
                    renderAuth()
                },
                failure = {
                    error = it.message.orEmpty()
                    message = ""
                    renderAuth()
                }
            )
        }.marginTop(10))
        shell.addView(registerCard)
        setContentView(root)
    }

    private fun renderApp() {
        val activeProfile = profile ?: return renderAuth()
        val root = LinearLayout(this).vertical()
        root.setBackgroundColor(bg)
        root.addView(header(activeProfile))

        val scroll = ScrollView(this)
        val content = LinearLayout(this).vertical().pad(14)
        scroll.addView(content)

        content.addView(topbar(activeProfile))
        if (message.isNotBlank()) content.addView(alert(message, false))
        if (error.isNotBlank()) content.addView(alert(error, true))

        if (activeProfile.role == "member" && activeProfile.status == "pending_approval") {
            content.addView(card().apply {
                addView(text("Waiting for admin approval", 24, brandDark, true))
                addView(text("Your registration is saved. Once an admin approves the account, bookings will unlock.", 16, muted, false).marginTop(6))
            })
        } else {
            when (tab) {
                "dashboard" -> renderDashboard(content, activeProfile)
                "calendar" -> renderCalendar(content, activeProfile)
                "bookings" -> renderBookings(content, activeProfile)
                "members" -> renderMembers(content, activeProfile)
                "classes" -> renderClasses(content, activeProfile)
                "attendance" -> renderAttendance(content, activeProfile)
                "reports" -> renderReports(content)
                "profile" -> renderProfile(content, activeProfile)
            }
        }

        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
    }

    private fun header(activeProfile: Profile): View {
        val outer = LinearLayout(this).vertical()
        outer.setBackgroundColor(brandDark)
        outer.setPadding(dp(12), dp(12), dp(12), dp(10))

        val titleRow = LinearLayout(this).horizontal(Gravity.CENTER_VERTICAL)
        titleRow.addView(ImageView(this).apply {
            setImageResource(resources.getIdentifier("spinx_logo", "drawable", packageName))
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = rounded(Color.BLACK, 0, 0, 10)
            layoutParams = LinearLayout.LayoutParams(dp(44), dp(44)).withRight(10)
        })
        titleRow.addView(text("SpinX Studio", 22, Color.WHITE, true), LinearLayout.LayoutParams(0, -2, 1f))
        titleRow.addView(outlineButton("Log out") {
            val token = session?.accessToken
            clearSession()
            if (token != null) background({ api.signOut(token) }, {}, {})
            renderAuth()
        })
        outer.addView(titleRow)

        val roleText = text(activeProfile.role, 14, Color.rgb(202, 214, 207), false)
        roleText.setPadding(dp(54), 0, 0, 0)
        outer.addView(roleText)

        val tabs = HorizontalScrollView(this)
        tabs.isHorizontalScrollBarEnabled = false
        val tabRow = LinearLayout(this).horizontal().apply { setPadding(0, dp(10), 0, 0) }
        tabs.addView(tabRow)
        tabsFor(activeProfile).forEach { item ->
            tabRow.addView(navButton(item, item == tab) {
                message = ""
                error = ""
                selectedBookingClassId = null
                tab = item
                renderApp()
            })
        }
        outer.addView(tabs)
        return outer
    }

    private fun topbar(activeProfile: Profile): View {
        val row = LinearLayout(this).horizontal(Gravity.CENTER_VERTICAL)
        val left = LinearLayout(this).vertical()
        left.addView(text(tabTitle(tab), 30, brandDark, true))
        val status = text("${activeProfile.fullName} - ${activeProfile.status}  ${activeProfile.paymentStatus}", 16, muted, false)
        left.addView(status.marginTop(4))
        row.addView(left, LinearLayout.LayoutParams(0, -2, 1f))
        row.addView(TextView(this).apply {
            text = activeProfile.initials
            textSize = 18f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            background = rounded(brand, 0, 0, 12)
            layoutParams = LinearLayout.LayoutParams(dp(52), dp(52))
        })
        return row.marginBottom(14)
    }

    private fun renderDashboard(content: LinearLayout, activeProfile: Profile) {
        if (activeProfile.canTeach) {
            val members = data.members
            val booked = data.bookings.count { it.status == "booked" }
            val wait = data.waitlist.count { it.status == "waiting" }
            val metrics = listOf(
                "Total members" to members.size,
                "Active" to members.count { it.status == "active" },
                "Pending" to members.count { it.status == "pending_approval" },
                "Unpaid" to members.count { it.paymentStatus == "unpaid" },
                "Bookings" to booked,
                "Waiting list" to wait
            )
            metrics.chunked(2).forEach { pair ->
                val row = LinearLayout(this).horizontal()
                pair.forEach { row.addView(metricCard(it.first, it.second.toString()), LinearLayout.LayoutParams(0, -2, 1f).withRight(8)) }
                content.addView(row)
            }
            content.addView(section("Today") {
                val today = classesForDate(LocalDate.now())
                if (today.isEmpty()) addView(text("No classes scheduled for today.", 16, muted, false))
                today.forEach { addView(classSummary(it, activeProfile, false)) }
            }.marginTop(10))
            content.addView(section("Needs attention") {
                attention("Pending approvals", members.count { it.status == "pending_approval" }, "members")
                attention("Unpaid members", members.count { it.paymentStatus == "unpaid" }, "members")
                attention("No-show warnings", members.count { it.noShowCount > 0 }, "members")
            }.marginTop(10))
        } else {
            val mine = data.bookings.filter { it.userId == activeProfile.id && it.status == "booked" }
            val attendedDates = data.attendance.filter { it.userId == activeProfile.id && it.status == "present" }.mapNotNull { classById(it.classId)?.date }.toSet()
            val monthCount = attendedDates.count { it.year == LocalDate.now().year && it.month == LocalDate.now().month }
            content.addView(card().apply {
                addView(text("Monthly streak", 22, brandDark, true))
                addView(text("$monthCount classes attended this month", 28, brand, true).marginTop(10))
                addView(text("Streaks only count weeks where SpinX has classes, so quiet weeks do not punish members.", 14, muted, false).marginTop(8))
            })
            content.addView(section("Upcoming classes") {
                visibleClasses().filter { it.startsAt.toLocalDate() >= LocalDate.now() }.take(5).forEach { klass ->
                    addView(classSummary(klass, activeProfile, true))
                }
            }.marginTop(10))
            content.addView(section("My bookings") {
                addView(text("${mine.size} upcoming active booking${if (mine.size == 1) "" else "s"}", 16, muted, false))
            }.marginTop(10))
        }
    }

    private fun LinearLayout.attention(label: String, count: Int, openTab: String) {
        val button = secondaryButton("$label: $count") {
            tab = openTab
            renderApp()
        }
        addView(button.marginTop(8))
    }

    private fun renderCalendar(content: LinearLayout, activeProfile: Profile) {
        content.addView(card().apply {
            val head = LinearLayout(context).horizontal(Gravity.CENTER_VERTICAL)
            head.addView(primaryButton("<") {
                calendarMonth = calendarMonth.minusMonths(1)
                renderApp()
            }, LinearLayout.LayoutParams(dp(52), dp(48)))
            head.addView(text(calendarMonth.format(DateTimeFormatter.ofPattern("MMMM yyyy")), 24, brandDark, true).center(), LinearLayout.LayoutParams(0, -2, 1f))
            head.addView(primaryButton(">") {
                calendarMonth = calendarMonth.plusMonths(1)
                renderApp()
            }, LinearLayout.LayoutParams(dp(52), dp(48)))
            addView(head)
            addView(calendarGrid().marginTop(14))
        })
        content.addView(section(selectedDate.format(DateTimeFormatter.ofPattern("EEEE, dd MMMM yyyy"))) {
            val list = classesForDate(selectedDate)
            addView(text("${list.size} class${if (list.size == 1) "" else "es"}", 16, muted, false))
            if (activeProfile.canTeach) addView(secondaryButton("Add classes") {
                tab = "classes"
                renderApp()
            }.marginTop(8))
            if (list.isEmpty()) addView(text("No classes on this date.", 16, muted, false).marginTop(12))
            list.forEach { addView(classSummary(it, activeProfile, true).marginTop(10)) }
        }.marginTop(14))
    }

    private fun calendarGrid(): View {
        val root = LinearLayout(this).vertical()
        val days = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
        val dayRow = LinearLayout(this).horizontal()
        days.forEach { day -> dayRow.addView(text(day, 12, muted, true).center(), LinearLayout.LayoutParams(0, -2, 1f)) }
        root.addView(dayRow)

        val first = calendarMonth.atDay(1)
        var cursor = first.minusDays(first.dayOfWeek.value % 7L)
        repeat(6) {
            val row = LinearLayout(this).horizontal()
            repeat(7) {
                val date = cursor
                val availability = availabilityForDate(date)
                val label = buildString {
                    append(date.dayOfMonth)
                    if (availability.classCount > 0) append("\n${availability.left} left")
                }
                val button = Button(this).apply {
                    text = label
                    textSize = 12f
                    setTextColor(if (date.month == calendarMonth.month) brandDark else Color.rgb(150, 160, 155))
                    typeface = Typeface.DEFAULT_BOLD
                    background = rounded(
                        when {
                            date == selectedDate -> brand
                            availability.full -> Color.rgb(255, 242, 239)
                            availability.left > 0 -> Color.rgb(247, 255, 249)
                            else -> Color.rgb(251, 252, 251)
                        },
                        if (date == selectedDate) brand else line,
                        1,
                        9
                    )
                    if (date == selectedDate) setTextColor(Color.WHITE)
                    setOnClickListener {
                        selectedDate = date
                        calendarMonth = YearMonth.from(date)
                        renderApp()
                    }
                }
                row.addView(button, LinearLayout.LayoutParams(0, dp(62), 1f).withMargins(2))
                cursor = cursor.plusDays(1)
            }
            root.addView(row.marginTop(4))
        }
        return root
    }

    private fun renderBookings(content: LinearLayout, activeProfile: Profile) {
        if (activeProfile.canTeach) {
            val selected = selectedBookingClassId?.let { classById(it) }
            if (selected != null) {
                content.addView(staffBookingDetails(selected))
                return
            }
            val now = LocalDate.now()
            content.addView(section("Class bookings") {
                addView(text("Tap a class to see its booking list.", 15, muted, false))
                visibleClasses().filter { it.date >= now }.take(30).forEach { klass ->
                    addView(bookingClassButton(klass).marginTop(8))
                }
            })
            content.addView(section("Done / archive") {
                visibleClasses().filter { it.date < now }.takeLast(12).reversed().forEach { klass ->
                    addView(bookingClassButton(klass).marginTop(8))
                }
            }.marginTop(12))
        } else {
            val now = LocalDate.now()
            val mine = data.bookings.filter { it.userId == activeProfile.id }
            val upcoming = mine.filter { it.status == "booked" && (classById(it.classId)?.date ?: now) >= now }.sortedBy { classById(it.classId)?.startsAt }
            val archive = mine.filter { it !in upcoming }.sortedByDescending { classById(it.classId)?.startsAt }
            content.addView(section("Upcoming bookings") {
                if (upcoming.isEmpty()) addView(text("No upcoming bookings.", 16, muted, false))
                upcoming.forEach { addView(memberBookingCard(it, true).marginTop(8)) }
            })
            content.addView(section("Done / archive") {
                if (archive.isEmpty()) addView(text("No archived bookings yet.", 16, muted, false))
                archive.forEach { addView(memberBookingCard(it, false).marginTop(8)) }
            }.marginTop(12))
        }
    }

    private fun renderMembers(content: LinearLayout, activeProfile: Profile) {
        if (!activeProfile.canManage) {
            content.addView(alert("Only admins can manage members.", true))
            return
        }
        content.addView(section("Members") {
            data.members.forEach { member ->
                addView(memberRow(member, activeProfile).marginTop(10))
            }
        })
    }

    private fun renderClasses(content: LinearLayout, activeProfile: Profile) {
        if (!activeProfile.canTeach) {
            content.addView(alert("Only admins and instructors can manage classes.", true))
            return
        }
        content.addView(classPlanner(activeProfile))
        content.addView(section("Selected day") {
            val list = classesForDate(selectedDate)
            addView(text("${list.size} class${if (list.size == 1) "" else "es"}", 16, muted, false))
            if (list.isEmpty()) addView(text("No classes on selected day.", 16, muted, false).marginTop(10))
            list.forEach { addView(manageClassCard(it).marginTop(10)) }
        }.marginTop(12))
        content.addView(section("Upcoming schedule") {
            visibleClasses().filter { it.date >= LocalDate.now().minusDays(1) }.take(24).forEach {
                addView(manageClassCard(it).marginTop(10))
            }
        }.marginTop(12))
    }

    private fun classPlanner(activeProfile: Profile): View {
        val card = section("Class planner")
        card.addView(text(selectedDate.format(DateTimeFormatter.ofPattern("EEEE, dd MMMM yyyy")), 16, muted, false))
        val title = field("Class name").apply { setText("Morning Spin") }
        card.addView(title)
        val instructorOptions = data.members.filter { it.role == "admin" || it.role == "instructor" }
        val instructorSpinner = spinner(instructorOptions.map { it.fullName.ifBlank { it.email } })
        card.addView(text("Instructor", 14, muted, true).marginTop(8))
        card.addView(instructorSpinner)
        val startDate = field("Start date YYYY-MM-DD").apply { setText(selectedDate.toString()) }
        val startTime = field("Start time HH:mm").apply { setText("05:30") }
        val duration = field("Duration minutes").apply { setText("45") }
        val repeat = spinner(listOf("One class only", "Repeat weekly"))
        val until = field("Until date YYYY-MM-DD").apply { setText(selectedDate.plusDays(28).toString()) }
        val skip = field("Skip dates, comma separated")
        val notes = field("Notes", minLines = 3)
        listOf(startDate, startTime, duration).forEach { card.addView(it) }
        card.addView(repeat)
        val weekdays = listOf("Mon" to 1, "Tue" to 2, "Wed" to 3, "Thu" to 4, "Fri" to 5, "Sat" to 6, "Sun" to 0)
        val checks = weekdays.map { (label, value) ->
            CheckBox(this).apply {
                text = label
                isChecked = value == selectedDate.dayOfWeek.value % 7
                setTextColor(brandDark)
                buttonTintList = android.content.res.ColorStateList.valueOf(brand)
            }
        }
        val checkWrap = LinearLayout(this).vertical()
        checks.chunked(3).forEach { group ->
            val row = LinearLayout(this).horizontal()
            group.forEach { row.addView(it, LinearLayout.LayoutParams(0, -2, 1f)) }
            checkWrap.addView(row)
        }
        card.addView(checkWrap)
        card.addView(until)
        card.addView(skip)
        card.addView(notes)
        card.addView(primaryButton("Create schedule") {
            val selectedInstructor = instructorOptions.getOrNull(instructorSpinner.selectedItemPosition)?.id ?: activeProfile.id
            val rows = buildClassRows(
                title = title.text.toString(),
                instructorId = selectedInstructor,
                startDate = startDate.text.toString(),
                startTime = startTime.text.toString(),
                duration = duration.text.toString().toIntOrNull() ?: 45,
                repeatWeekly = repeat.selectedItemPosition == 1,
                weekdays = checks.mapIndexedNotNull { index, check -> if (check.isChecked) weekdays[index].second else null },
                untilDate = until.text.toString(),
                skipDates = skip.text.toString(),
                notes = notes.text.toString()
            )
            if (rows.length() == 0) return@primaryButton showError("No classes matched that schedule.")
            runApi(if (rows.length() == 1) "Class created." else "${rows.length()} classes created.") {
                api.createClasses(rows, requireToken())
            }
        }.marginTop(10))
        return card
    }

    private fun renderAttendance(content: LinearLayout, activeProfile: Profile) {
        if (!activeProfile.canTeach) {
            content.addView(alert("Only admins and instructors can mark attendance.", true))
            return
        }
        content.addView(section("Attendance register") {
            visibleClasses().filter { it.date >= LocalDate.now().minusDays(14) }.take(30).forEach { klass ->
                addView(attendanceClassCard(klass).marginTop(10))
            }
        })
    }

    private fun renderReports(content: LinearLayout) {
        content.addView(section("Reports") {
            val rows = listOf(
                "Membership report" to data.members.size,
                "Booking report" to data.bookings.size,
                "Attendance report" to data.attendance.size,
                "Waiting-list report" to data.waitlist.size,
                "Class report" to data.classes.size
            )
            rows.forEach { (label, count) ->
                addView(secondaryButton("$label - $count records") {
                    shareCsv(label)
                }.marginTop(8))
            }
        })
    }

    private fun renderProfile(content: LinearLayout, activeProfile: Profile) {
        val first = labeledField("First name", activeProfile.firstName)
        val last = labeledField("Last name", activeProfile.lastName)
        val mobile = labeledField("Mobile number", activeProfile.mobile)
        val emergency = labeledField("Emergency contact", activeProfile.emergencyContact)
        content.addView(section("Profile") {
            addView(text("Role: ${activeProfile.role}", 15, muted, false))
            addView(text("Status: ${activeProfile.status} / ${activeProfile.paymentStatus}", 15, muted, false).marginTop(4))
            listOf(first, last, mobile, emergency).forEach { addView(it.first.marginTop(10)); addView(it.second) }
            addView(primaryButton("Save profile") {
                runApi("Profile saved.") {
                    api.updateMyProfile(
                        first.second.text.toString(),
                        last.second.text.toString(),
                        mobile.second.text.toString(),
                        emergency.second.text.toString(),
                        requireToken()
                    )
                }
            }.marginTop(12))
        })
    }

    private fun classSummary(klass: SpinClass, activeProfile: Profile, actions: Boolean): View {
        val bookings = bookingsForClass(klass.id)
        val availability = availabilityForClass(klass)
        val mine = bookings.find { it.userId == activeProfile.id && it.status == "booked" }
        return card().apply {
            addView(text(klass.title, 21, brandDark, true))
            addView(text("${niceDate(klass)} - ${klass.durationMinutes} min - ${if (availability.full) "Full" else "${availability.left} spots left"}", 15, muted, false).marginTop(4))
            addView(text("Instructor: ${instructorName(klass)}", 15, brand, true).marginTop(4))
            addView(pill(klass.status).marginTop(8))
            if (!klass.notes.isNullOrBlank()) addView(text(klass.notes, 14, muted, false).marginTop(6))
            if (actions && activeProfile.role == "member") {
                when {
                    mine != null -> addView(secondaryButton("Cancel booking") { cancelBooking(mine.id) }.marginTop(10))
                    availability.full && activeProfile.canBook && klass.status == "active" -> addView(secondaryButton("Join waiting list") { joinWaitlist(klass.id) }.marginTop(10))
                    activeProfile.canBook && klass.status == "active" -> addView(primaryButton("Book a bike") { bookClass(klass.id) }.marginTop(10))
                    !activeProfile.canBook -> addView(text("Booking is locked until your account is active and paid.", 14, muted, false).marginTop(10))
                }
            }
            if (actions && activeProfile.canTeach) {
                addView(text("${bookings.count { it.status == "booked" }} member bikes booked / ${availability.left} open", 14, brand, true).marginTop(8))
                if (activeProfile.canManage) addView(adminBookMemberView(klass).marginTop(10))
                addView(classActions(klass).marginTop(10))
                bookings.filter { it.status == "booked" }.forEach {
                    val member = memberById(it.userId)
                    addView(text("Bike ${it.bikeNumber} - ${member?.fullName ?: "Member"}", 14, muted, false).marginTop(5))
                }
            }
        }
    }

    private fun manageClassCard(klass: SpinClass): View {
        val activeProfile = profile ?: return View(this)
        return classSummary(klass, activeProfile, true)
    }

    private fun memberBookingCard(booking: Booking, canCancel: Boolean): View {
        val klass = classById(booking.classId)
        return card().apply {
            addView(text(klass?.title ?: "Class", 18, brandDark, true))
            addView(text(klass?.let { niceDate(it) } ?: "Class removed", 15, muted, false).marginTop(4))
            addView(pill(if (!canCancel && booking.status == "booked") "done" else booking.status).marginTop(8))
            if (canCancel) addView(secondaryButton("Cancel") { cancelBooking(booking.id) }.marginTop(8))
        }
    }

    private fun bookingClassButton(klass: SpinClass): View {
        val availability = availabilityForClass(klass)
        return secondaryButton("${klass.title}\n${niceDate(klass)}\n${availability.booked}/9 booked - ${if (availability.full) "Full" else "${availability.left} left"}") {
            selectedBookingClassId = klass.id
            renderApp()
        }
    }

    private fun staffBookingDetails(klass: SpinClass): View = section(klass.title) {
        val availability = availabilityForClass(klass)
        addView(secondaryButton("Back to classes") {
            selectedBookingClassId = null
            renderApp()
        })
        addView(text("${niceDate(klass)} - Instructor: ${instructorName(klass)}", 15, muted, false).marginTop(8))
        addView(text("${availability.booked}/9 booked - ${availability.left} left", 16, brand, true).marginTop(8))
        addView(adminBookMemberView(klass).marginTop(10))
        bookingsForClass(klass.id).filter { it.status == "booked" }.forEach { booking ->
            val member = memberById(booking.userId)
            addView(card().apply {
                addView(text("Bike ${booking.bikeNumber}: ${member?.fullName ?: "Member"}", 17, brandDark, true))
                addView(text(member?.mobile ?: "", 14, muted, false).marginTop(3))
                addView(secondaryButton("Cancel booking") { cancelBooking(booking.id) }.marginTop(8))
            }.marginTop(8))
        }
    }

    private fun memberRow(member: Profile, activeProfile: Profile): View = card().apply {
        addView(text(member.fullName, 19, brandDark, true))
        addView(text(member.email, 14, muted, false).marginTop(3))
        addView(text("${member.role} - ${member.status} - ${member.paymentStatus} - ${member.noShowCount} no-shows", 14, muted, false).marginTop(5))
        if (member.status == "pending_approval") {
            addView(primaryButton("Approve") { approveMember(member.id) }.marginTop(8))
        }
        addView(secondaryButton(if (member.paymentStatus == "paid") "Mark unpaid" else "Mark paid") {
            updateMember(member.id, JSONObject().put("payment_status", if (member.paymentStatus == "paid") "unpaid" else "paid"))
        }.marginTop(8))
        addView(secondaryButton(if (member.status == "active") "Suspend" else "Activate") {
            updateMember(member.id, JSONObject().put("status", if (member.status == "active") "suspended" else "active"))
        }.marginTop(8))
        if (member.id != activeProfile.id) {
            addView(secondaryButton(if (member.role == "instructor") "Make member" else "Make instructor") {
                updateMember(member.id, JSONObject().put("role", if (member.role == "instructor") "member" else "instructor").put("status", "active"))
            }.marginTop(8))
            addView(dangerButton(if (member.status == "pending_approval") "Decline/delete" else "Delete") {
                confirm("Delete this member and their login account?") { declineMember(member.id) }
            }.marginTop(8))
        }
    }

    private fun adminBookMemberView(klass: SpinClass): View {
        val wrap = LinearLayout(this).vertical()
        val bookedUserIds = bookingsForClass(klass.id).filter { it.status == "booked" }.map { it.userId }.toSet()
        val members = data.members.filter { it.role == "member" && it.status == "active" && it.id !in bookedUserIds }
        val spinner = spinner(members.map { it.fullName })
        wrap.addView(spinner)
        wrap.addView(secondaryButton("Book member spot") {
            val member = members.getOrNull(spinner.selectedItemPosition)
            if (member == null) showError("No active member available.") else adminBook(klass.id, member.id)
        }.marginTop(8))
        return wrap
    }

    private fun classActions(klass: SpinClass): View {
        val wrap = LinearLayout(this).vertical()
        val next = if (klass.status == "cancelled") "active" else "cancelled"
        wrap.addView(secondaryButton(if (next == "cancelled") "Cancel this class" else "Reopen this class") {
            updateClassScope(klass, next, false)
        })
        wrap.addView(secondaryButton(if (next == "cancelled") "Cancel this and future" else "Reopen this and future") {
            confirm("This will update this class and future matching classes. Continue?") {
                updateClassScope(klass, next, true)
            }
        }.marginTop(8))
        return wrap
    }

    private fun attendanceClassCard(klass: SpinClass): View = card().apply {
        addView(text(klass.title, 20, brandDark, true))
        addView(text(niceDate(klass), 15, muted, false).marginTop(3))
        val bookings = bookingsForClass(klass.id).filter { it.status == "booked" }
        addView(text("${bookings.size}/9 booked", 15, brand, true).marginTop(6))
        bookings.forEach { booking ->
            val member = memberById(booking.userId)
            val row = LinearLayout(context).vertical()
            row.layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) }
            row.addView(text("${member?.fullName ?: "Member"} - Bike ${booking.bikeNumber}", 15, brandDark, true))
            val buttons = LinearLayout(context).horizontal()
            buttons.addView(secondaryButton("Present") { markAttendance(klass.id, booking.userId, "present") }, LinearLayout.LayoutParams(0, -2, 1f).withRight(6))
            buttons.addView(secondaryButton("Absent") { markAttendance(klass.id, booking.userId, "absent") }, LinearLayout.LayoutParams(0, -2, 1f))
            row.addView(buttons.marginTop(5))
            addView(row)
        }
    }

    private fun buildClassRows(
        title: String,
        instructorId: String,
        startDate: String,
        startTime: String,
        duration: Int,
        repeatWeekly: Boolean,
        weekdays: List<Int>,
        untilDate: String,
        skipDates: String,
        notes: String
    ): JSONArray {
        val rows = JSONArray()
        val start = LocalDate.parse(startDate.trim())
        val until = if (repeatWeekly) LocalDate.parse(untilDate.trim()) else start
        val time = LocalTime.parse(startTime.trim())
        val skip = skipDates.split(",").map { it.trim() }.filter { it.isNotBlank() }.toSet()
        val selectedDays = if (weekdays.isEmpty()) listOf(start.dayOfWeek.value % 7) else weekdays
        val seriesId = if (repeatWeekly) UUID.randomUUID().toString() else null
        var cursor = start
        while (!cursor.isAfter(until)) {
            val dayValue = cursor.dayOfWeek.value % 7
            val shouldCreate = if (repeatWeekly) selectedDays.contains(dayValue) else cursor == start
            if (shouldCreate && cursor.toString() !in skip) {
                rows.put(JSONObject()
                    .put("title", title.ifBlank { "Spin class" })
                    .put("starts_at", cursor.atTime(time).atZone(ZoneId.systemDefault()).toOffsetDateTime().toString())
                    .put("duration_minutes", duration)
                    .put("instructor_id", instructorId)
                    .put("series_id", seriesId)
                    .put("notes", notes))
            }
            cursor = cursor.plusDays(1)
        }
        return rows
    }

    private fun tabsFor(activeProfile: Profile): List<String> = when {
        activeProfile.canManage -> listOf("dashboard", "calendar", "members", "classes", "bookings", "attendance", "reports", "profile")
        activeProfile.canTeach -> listOf("dashboard", "calendar", "classes", "bookings", "attendance", "profile")
        else -> listOf("dashboard", "calendar", "bookings", "profile")
    }

    private fun tabTitle(value: String): String = value.replaceFirstChar { it.uppercaseChar() }
    private fun requireToken(): String = session?.accessToken ?: error("Session expired.")
    private fun visibleClasses() = data.classes.sortedBy { it.startsAt }
    private fun classesForDate(date: LocalDate) = visibleClasses().filter { it.date == date }
    private fun classById(id: String) = data.classes.find { it.id == id }
    private fun memberById(id: String?) = data.members.find { it.id == id }
    private fun bookingsForClass(id: String) = data.bookings.filter { it.classId == id }
    private fun instructorName(klass: SpinClass) = memberById(klass.instructorId)?.fullName ?: "Unassigned"

    private data class Availability(val booked: Int, val left: Int, val full: Boolean, val classCount: Int = 0)

    private fun availabilityForClass(klass: SpinClass): Availability {
        val booked = bookingsForClass(klass.id).count { it.status == "booked" }
        val left = max(0, 9 - booked)
        return Availability(booked, left, left == 0)
    }

    private fun availabilityForDate(date: LocalDate): Availability {
        val list = classesForDate(date).filter { it.status == "active" }
        val left = list.sumOf { availabilityForClass(it).left }
        val booked = list.sumOf { availabilityForClass(it).booked }
        return Availability(booked, left, list.isNotEmpty() && left == 0, list.size)
    }

    private fun niceDate(klass: SpinClass): String =
        klass.startsAt.format(DateTimeFormatter.ofPattern("EEE, dd MMM, HH:mm"))

    private fun matchingFutureIds(klass: SpinClass): List<String> {
        return data.classes.filter { candidate ->
            candidate.startsAt >= klass.startsAt &&
                (klass.seriesId != null && candidate.seriesId == klass.seriesId ||
                    klass.seriesId == null &&
                    candidate.title == klass.title &&
                    candidate.instructorId == klass.instructorId &&
                    candidate.durationMinutes == klass.durationMinutes &&
                    candidate.startsAt.toLocalTime() == klass.startsAt.toLocalTime())
        }.map { it.id }
    }

    private fun bookClass(classId: String) = runApi("Spot booked.") { api.bookNextBike(classId, requireToken()) }
    private fun joinWaitlist(classId: String) = runApi("Added to waiting list.") { api.joinWaitlist(classId, requireToken()) }
    private fun cancelBooking(id: String) = runApi("Booking cancelled.") { api.cancelBooking(id, requireToken()) }
    private fun adminBook(classId: String, userId: String) = runApi("Member spot booked.") { api.adminBookMember(classId, userId, requireToken()) }
    private fun approveMember(id: String) = runApi("Member approved.") { api.approveMember(id, requireToken()) }
    private fun declineMember(id: String) = runApi("Member deleted.") { api.declineMember(id, requireToken()) }
    private fun updateMember(id: String, patch: JSONObject) = runApi("Member updated.") { api.updateMember(id, patch, requireToken()) }
    private fun markAttendance(classId: String, userId: String, status: String) = runApi("Attendance saved.") { api.markAttendance(classId, userId, status, requireToken()) }
    private fun updateClassScope(klass: SpinClass, status: String, future: Boolean) = runApi("Class updated.") {
        val patch = JSONObject().put("status", status)
        if (future) api.updateClasses(matchingFutureIds(klass), patch, requireToken()) else api.updateClass(klass.id, patch, requireToken())
    }

    private fun shareCsv(label: String) {
        val text = when {
            label.startsWith("Membership") -> data.members.joinToString("\n", "name,email,role,status,payment\n") { "${it.fullName},${it.email},${it.role},${it.status},${it.paymentStatus}" }
            label.startsWith("Booking") -> data.bookings.joinToString("\n", "id,class_id,user_id,status\n") { "${it.id},${it.classId},${it.userId},${it.status}" }
            label.startsWith("Attendance") -> data.attendance.joinToString("\n", "class_id,user_id,status\n") { "${it.classId},${it.userId},${it.status}" }
            label.startsWith("Waiting") -> data.waitlist.joinToString("\n", "class_id,user_id,status\n") { "${it.classId},${it.userId},${it.status}" }
            else -> data.classes.joinToString("\n", "title,starts_at,status\n") { "${it.title},${it.startsAt},${it.status}" }
        }
        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
            type = "text/csv"
            putExtra(Intent.EXTRA_SUBJECT, label)
            putExtra(Intent.EXTRA_TEXT, text)
        }, "Share $label"))
    }

    private fun showError(value: String) {
        Toast.makeText(this, value, Toast.LENGTH_LONG).show()
    }

    private fun confirm(text: String, action: () -> Unit) {
        AlertDialog.Builder(this)
            .setMessage(text)
            .setPositiveButton("Yes") { _, _ -> action() }
            .setNegativeButton("No", null)
            .show()
    }

    private fun cleanAuthError(value: String): String =
        if (value.lowercase().contains("email not confirmed")) {
            "This account is not approved/confirmed yet. Ask an admin to approve it in Members."
        } else value

    private fun renderLoading(label: String) {
        setContentView(FrameLayout(this).apply {
            setBackgroundColor(bg)
            addView(text(label, 20, brandDark, true).center(), FrameLayout.LayoutParams(-1, -1))
        })
    }

    private fun section(title: String, block: LinearLayout.() -> Unit = {}): LinearLayout = card().apply {
        addView(text(title, 24, brandDark, true))
        block()
    }

    private fun metricCard(label: String, value: String): View = card().apply {
        addView(text(label, 14, muted, true))
        addView(text(value, 30, brand, true).marginTop(6))
    }

    private fun card(): LinearLayout = LinearLayout(this).vertical().apply {
        background = rounded(panel, line, 1, 12)
        setPadding(dp(16), dp(16), dp(16), dp(16))
    }

    private fun alert(value: String, isError: Boolean): View = TextView(this).apply {
        text = value
        textSize = 15f
        setTextColor(if (isError) danger else brand)
        background = rounded(if (isError) Color.rgb(255, 240, 238) else Color.rgb(230, 244, 235), if (isError) Color.rgb(255, 170, 160) else Color.rgb(135, 200, 160), 1, 10)
        setPadding(dp(12), dp(12), dp(12), dp(12))
    }.marginBottom(10)

    private fun text(value: String, size: Int, color: Int, bold: Boolean): TextView = TextView(this).apply {
        text = value
        textSize = size.toFloat()
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    private fun field(hint: String, minLines: Int = 1): EditText = EditText(this).apply {
        this.hint = hint
        this.minLines = minLines
        setSingleLine(minLines == 1)
        textSize = 16f
        setTextColor(brandDark)
        setHintTextColor(muted)
        background = rounded(Color.WHITE, line, 1, 8)
        setPadding(dp(12), 0, dp(12), 0)
        layoutParams = LinearLayout.LayoutParams(-1, if (minLines == 1) dp(52) else dp(96)).withTop(10)
    }

    private fun labeledField(label: String, value: String): Pair<TextView, EditText> =
        text(label, 13, muted, true) to field(label).apply { setText(value) }

    private fun spinner(values: List<String>): Spinner = Spinner(this).apply {
        adapter = ArrayAdapter(context, android.R.layout.simple_spinner_dropdown_item, values.ifEmpty { listOf("None") })
        background = rounded(Color.WHITE, line, 1, 8)
        layoutParams = LinearLayout.LayoutParams(-1, dp(52)).withTop(8)
        onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {}
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
    }

    private fun primaryButton(label: String, action: () -> Unit): Button = button(label, brand, Color.WHITE, action)
    private fun secondaryButton(label: String, action: () -> Unit): Button = button(label, Color.rgb(233, 238, 233), brand, action)
    private fun dangerButton(label: String, action: () -> Unit): Button = button(label, danger, Color.WHITE, action)
    private fun outlineButton(label: String, action: () -> Unit): Button = button(label, Color.TRANSPARENT, Color.WHITE, action).apply {
        background = rounded(Color.TRANSPARENT, Color.rgb(63, 91, 74), 1, 24)
    }

    private fun navButton(label: String, active: Boolean, action: () -> Unit): Button =
        button(tabTitle(label), if (active) brand else Color.TRANSPARENT, Color.WHITE, action).apply {
            background = rounded(if (active) brand else Color.TRANSPARENT, if (active) accent else Color.TRANSPARENT, 1, 24)
            layoutParams = LinearLayout.LayoutParams(-2, dp(44)).withRight(8)
        }

    private fun button(label: String, bgColor: Int, fg: Int, action: () -> Unit): Button = Button(this).apply {
        text = label
        textSize = 15f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(fg)
        background = rounded(bgColor, 0, 0, 8)
        setPadding(dp(12), 0, dp(12), 0)
        isAllCaps = false
        minHeight = dp(44)
        setOnClickListener { action() }
    }

    private fun pill(value: String): TextView = text(value, 13, if (value in listOf("active", "paid", "done")) brand else danger, true).apply {
        background = rounded(if (value in listOf("active", "paid", "done")) Color.rgb(230, 244, 235) else Color.rgb(255, 240, 238), 0, 0, 18)
        setPadding(dp(10), dp(5), dp(10), dp(5))
    }

    private fun rounded(color: Int, stroke: Int, strokeWidth: Int, radius: Int): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(radius).toFloat()
            if (strokeWidth > 0) setStroke(dp(strokeWidth), stroke)
        }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}

private fun LinearLayout.vertical(): LinearLayout = apply { orientation = LinearLayout.VERTICAL }
private fun LinearLayout.horizontal(gravityValue: Int = Gravity.NO_GRAVITY): LinearLayout = apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = gravityValue
}
private fun View.marginTop(value: Int): View = apply {
    layoutParams = ((layoutParams as? LinearLayout.LayoutParams) ?: LinearLayout.LayoutParams(-1, -2)).apply { topMargin = context.dp(value) }
}
private fun View.marginBottom(value: Int): View = apply {
    layoutParams = ((layoutParams as? LinearLayout.LayoutParams) ?: LinearLayout.LayoutParams(-1, -2)).apply { bottomMargin = context.dp(value) }
}
private fun View.withMargins(value: Int): View = apply {
    layoutParams = ((layoutParams as? LinearLayout.LayoutParams) ?: LinearLayout.LayoutParams(-1, -2)).apply {
        setMargins(context.dp(value), context.dp(value), context.dp(value), context.dp(value))
    }
}
private fun View.center(): View = apply { if (this is TextView) gravity = Gravity.CENTER }
private fun LinearLayout.pad(value: Int): LinearLayout = apply { setPadding(context.dp(value), context.dp(value), context.dp(value), context.dp(value)) }
private fun Context.dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
private fun LinearLayout.LayoutParams.withRight(value: Int): LinearLayout.LayoutParams = apply { rightMargin = value }
private fun LinearLayout.LayoutParams.withTop(value: Int): LinearLayout.LayoutParams = apply { topMargin = value }
private fun LinearLayout.LayoutParams.withMargins(value: Int): LinearLayout.LayoutParams = apply { setMargins(value, value, value, value) }
