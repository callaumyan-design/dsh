package com.smsrelay.secure.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.smsrelay.secure.core.Sms

/**
 * Local app-private database:
 *  - msg / delivery: the outbox of the sending phone, with per-channel delivery state and retries
 *  - inbox / part:   messages received over the encrypted channel (receiving phone)
 */
class Db private constructor(context: Context) :
    SQLiteOpenHelper(context.applicationContext, "relay.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE msg(id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE, sender TEXT, body TEXT," +
                " ts INTEGER, sim TEXT, sub_id INTEGER, device TEXT, created INTEGER)",
        )
        db.execSQL(
            "CREATE TABLE delivery(id INTEGER PRIMARY KEY AUTOINCREMENT, msg_id INTEGER, channel TEXT," +
                " state INTEGER, attempts INTEGER, next_at INTEGER, error TEXT, updated INTEGER)",
        )
        db.execSQL("CREATE INDEX delivery_due ON delivery(state, next_at)")
        db.execSQL("CREATE INDEX delivery_msg ON delivery(msg_id)")
        db.execSQL(
            "CREATE TABLE inbox(id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE, sender TEXT, body TEXT," +
                " ts INTEGER, received INTEGER, device TEXT, sim TEXT)",
        )
        db.execSQL(
            "CREATE TABLE part(uid TEXT, idx INTEGER, total INTEGER, sender TEXT, body TEXT, ts INTEGER," +
                " device TEXT, sim TEXT, created INTEGER, PRIMARY KEY(uid, idx))",
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

    // ------------------------------------------------------------------ outbox

    class Delivery(
        val id: Long,
        val msgId: Long,
        val channel: String,
        val state: Int,
        val attempts: Int,
        val nextAt: Long,
        val error: String?,
    )

    class OutItem(val id: Long, val sms: Sms, val deliveries: List<Delivery>)

    fun enqueue(sms: Sms, channels: List<String>) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val now = System.currentTimeMillis()
            val id = db.insert("msg", null, ContentValues().apply {
                put("uid", sms.uid); put("sender", sms.sender); put("body", sms.body); put("ts", sms.time)
                put("sim", sms.sim); put("sub_id", sms.subId); put("device", sms.device); put("created", now)
            })
            for (ch in channels) {
                db.insert("delivery", null, ContentValues().apply {
                    put("msg_id", id); put("channel", ch); put("state", PENDING); put("attempts", 0)
                    put("next_at", 0L); put("updated", now)
                })
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        pruneOutbox()
    }

    fun due(now: Long): List<Delivery> = readableDatabase.rawQuery(
        "SELECT id,msg_id,channel,state,attempts,next_at,error FROM delivery WHERE state=? AND next_at<=? ORDER BY id LIMIT 50",
        arrayOf(PENDING.toString(), now.toString()),
    ).use { c ->
        buildList {
            while (c.moveToNext()) {
                add(Delivery(c.getLong(0), c.getLong(1), c.getString(2), c.getInt(3), c.getInt(4), c.getLong(5), c.getString(6)))
            }
        }
    }

    fun nextDue(): Long? = readableDatabase.rawQuery(
        "SELECT MIN(next_at) FROM delivery WHERE state=?",
        arrayOf(PENDING.toString()),
    ).use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null }

    fun sms(msgId: Long): Sms? = readableDatabase.rawQuery(
        "SELECT uid,sender,body,ts,sim,device,sub_id FROM msg WHERE id=?",
        arrayOf(msgId.toString()),
    ).use { c ->
        if (c.moveToFirst()) Sms(c.getString(0), c.getString(1), c.getString(2), c.getLong(3), c.getString(4), c.getString(5), c.getInt(6)) else null
    }

    fun updateDelivery(id: Long, state: Int, attempts: Int, nextAt: Long, error: String?) {
        writableDatabase.update("delivery", ContentValues().apply {
            put("state", state); put("attempts", attempts); put("next_at", nextAt); put("error", error)
            put("updated", System.currentTimeMillis())
        }, "id=?", arrayOf(id.toString()))
    }

    /** The user pressed "retry": failed deliveries go back in the queue, waiting ones become due now. */
    fun retryMessage(msgId: Long) {
        writableDatabase.update("delivery", ContentValues().apply {
            put("state", PENDING); put("attempts", 0); put("next_at", 0L)
        }, "msg_id=? AND state=?", arrayOf(msgId.toString(), FAILED.toString()))
        writableDatabase.update("delivery", ContentValues().apply { put("next_at", 0L) },
            "msg_id=? AND state=?", arrayOf(msgId.toString(), PENDING.toString()))
    }

    fun recentOutbox(limit: Int): List<OutItem> {
        val db = readableDatabase
        val items = db.rawQuery(
            "SELECT id,uid,sender,body,ts,sim,device,sub_id FROM msg ORDER BY id DESC LIMIT ?",
            arrayOf(limit.toString()),
        ).use { c ->
            buildList {
                while (c.moveToNext()) {
                    add(c.getLong(0) to Sms(c.getString(1), c.getString(2), c.getString(3), c.getLong(4), c.getString(5), c.getString(6), c.getInt(7)))
                }
            }
        }
        return items.map { (id, sms) ->
            val ds = db.rawQuery(
                "SELECT id,msg_id,channel,state,attempts,next_at,error FROM delivery WHERE msg_id=? ORDER BY id",
                arrayOf(id.toString()),
            ).use { c ->
                buildList {
                    while (c.moveToNext()) {
                        add(Delivery(c.getLong(0), c.getLong(1), c.getString(2), c.getInt(3), c.getInt(4), c.getLong(5), c.getString(6)))
                    }
                }
            }
            OutItem(id, sms, ds)
        }
    }

    fun clearOutbox() {
        writableDatabase.execSQL("DELETE FROM delivery")
        writableDatabase.execSQL("DELETE FROM msg")
    }

    private fun pruneOutbox() {
        val db = writableDatabase
        val cutoff = System.currentTimeMillis() - 30L * 24 * 3600 * 1000
        // Keep the newest 300 messages and anything still waiting to be delivered.
        db.execSQL(
            "DELETE FROM msg WHERE (created < ? OR id NOT IN (SELECT id FROM msg ORDER BY id DESC LIMIT 300))" +
                " AND id NOT IN (SELECT msg_id FROM delivery WHERE state=$PENDING)",
            arrayOf(cutoff),
        )
        db.execSQL("DELETE FROM delivery WHERE msg_id NOT IN (SELECT id FROM msg)")
    }

    // ------------------------------------------------------------------ inbox

    class InItem(val id: Long, val sms: Sms, val received: Long)

    /** Returns false if this message was already stored (duplicate / replay). */
    fun addInbox(sms: Sms): Boolean {
        val id = writableDatabase.insertWithOnConflict("inbox", null, ContentValues().apply {
            put("uid", sms.uid); put("sender", sms.sender); put("body", sms.body); put("ts", sms.time)
            put("received", System.currentTimeMillis()); put("device", sms.device); put("sim", sms.sim)
        }, SQLiteDatabase.CONFLICT_IGNORE)
        if (id != -1L) {
            writableDatabase.execSQL("DELETE FROM inbox WHERE id NOT IN (SELECT id FROM inbox ORDER BY id DESC LIMIT 500)")
        }
        return id != -1L
    }

    fun hasInbox(uid: String): Boolean =
        readableDatabase.rawQuery("SELECT 1 FROM inbox WHERE uid=?", arrayOf(uid)).use { it.moveToFirst() }

    fun recentInbox(limit: Int): List<InItem> = readableDatabase.rawQuery(
        "SELECT id,uid,sender,body,ts,device,sim,received FROM inbox ORDER BY id DESC LIMIT ?",
        arrayOf(limit.toString()),
    ).use { c ->
        buildList {
            while (c.moveToNext()) {
                add(InItem(c.getLong(0), Sms(c.getString(1), c.getString(2), c.getString(3), c.getLong(4), c.getString(6), c.getString(5)), c.getLong(7)))
            }
        }
    }

    fun clearInbox() {
        writableDatabase.execSQL("DELETE FROM inbox")
        writableDatabase.execSQL("DELETE FROM part")
    }

    /** Stores one part of a long message; returns the full message once every part arrived. */
    fun addPart(uid: String, idx: Int, total: Int, sender: String, body: String, ts: Long, device: String, sim: String?): Sms? {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val now = System.currentTimeMillis()
            db.execSQL("DELETE FROM part WHERE created < ?", arrayOf(now - 48L * 3600 * 1000))
            db.insertWithOnConflict("part", null, ContentValues().apply {
                put("uid", uid); put("idx", idx); put("total", total); put("sender", sender); put("body", body)
                put("ts", ts); put("device", device); put("sim", sim); put("created", now)
            }, SQLiteDatabase.CONFLICT_IGNORE)
            val bodies = db.rawQuery(
                "SELECT idx, body FROM part WHERE uid=? AND total=? ORDER BY idx",
                arrayOf(uid, total.toString()),
            ).use { c -> buildList { while (c.moveToNext()) add(c.getInt(0) to c.getString(1)) } }
            val result = if (bodies.size == total && bodies.map { it.first } == (0 until total).toList()) {
                db.delete("part", "uid=?", arrayOf(uid))
                Sms(uid, sender, bodies.joinToString("") { it.second }, ts, sim, device)
            } else {
                null
            }
            db.setTransactionSuccessful()
            return result
        } finally {
            db.endTransaction()
        }
    }

    companion object {
        const val PENDING = 0
        const val SENT = 1
        const val FAILED = 2
        const val CANCELLED = 3

        @Volatile
        private var instance: Db? = null

        fun get(context: Context): Db =
            instance ?: synchronized(this) { instance ?: Db(context).also { instance = it } }
    }
}
