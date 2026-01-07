require('dotenv').config()
const express = require("express")
const sqlite3 = require("sqlite3").verbose()
const path = require("path")
const cron = require("node-cron")
const cors = require("cors")
const { ethers } = require("ethers")

const app = express()
const PORT = process.env.PORT || 3000

// 从环境变量获取配置
const RPC_URL = process.env.RPC_URL
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS
const COLLECTION_ADDRESS = process.env.COLLECTION_ADDRESS
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY
const ADMIN_USER = process.env.ADMIN_USER
const ADMIN_PASS = process.env.ADMIN_PASS
const ADMIN_PATH = process.env.ADMIN_PATH || "secret-admin-portal" 

// --- 管理员页面路由 (放在 API 之前) ---
app.get(`/${ADMIN_PATH}`, (req, res) => {
  const adminPage = path.join(__dirname, "admin.html");
  console.log(`正在尝试发送文件: ${adminPage}`);
  res.sendFile(adminPage, (err) => {
    if (err) {
      console.error("发送 admin.html 失败:", err);
      res.status(500).send("后台管理页面加载失败，请检查 backend 目录下是否存在 admin.html");
    }
  });
});
console.log(`管理后台路径已设置为: /${ADMIN_PATH}`)

app.use(express.json())
// 初始化 ethers 供应商和钱包
const provider = new ethers.JsonRpcProvider(RPC_URL)
const wallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider)

// ERC20 最小 ABI 用于转账
const MIN_ERC20_ABI = [
  "function transfer(address to, uint256 amount) public returns (bool)",
  "function decimals() view returns (uint8)"
]
const tokenContract = new ethers.Contract(TOKEN_ADDRESS, MIN_ERC20_ABI, wallet)

// 正式环境 CORS 配置
app.use(cors({
  origin: ["https://snowkoi.top", "https://www.snowkoi.top"],
  methods: ["GET", "POST"],
  credentials: true
}))

app.use(express.json())

const dbPath = path.join(__dirname, "lottery.db")
const db = new sqlite3.Database(dbPath)

// 数据库初始化
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time TEXT,
    end_time TEXT,
    status TEXT, -- active, processing, completed
    winner_address TEXT,
    prize_amount INTEGER DEFAULT 0,
    bonus_amount INTEGER DEFAULT 0
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER,
    user_address TEXT,
    tx_hash TEXT UNIQUE,
    created_at TEXT,
    FOREIGN KEY(round_id) REFERENCES rounds(id)
  )`)

  // 尝试为旧数据库添加 bonus_amount 字段
  db.run("ALTER TABLE rounds ADD COLUMN bonus_amount INTEGER DEFAULT 0", (err) => {
    // 如果列已存在，忽略错误
  })
})

// --- 核心逻辑：轮次管理 ---

// 获取当前进行中的轮次，如果没有则创建一个
async function getOrCreateActiveRound() {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM rounds WHERE status = 'active' ORDER BY id DESC LIMIT 1", (err, row) => {
      if (err) return reject(err)
      if (row) return resolve(row)

      // 创建新轮次
      const now = new Date()
      const endTime = new Date(now.getTime() + 15 * 60000) // 15分钟后
      
      const stmt = db.prepare("INSERT INTO rounds (start_time, end_time, status, prize_amount, bonus_amount) VALUES (?, ?, ?, ?, ?)")
      stmt.run(now.toISOString(), endTime.toISOString(), 'active', 0, 0, function(err) {
        if (err) return reject(err)
        db.get("SELECT * FROM rounds WHERE id = ?", [this.lastID], (err, newRow) => {
          resolve(newRow)
        })
      })
    })
  })
}

// 开奖逻辑
async function drawWinner(roundId) {
  console.log(`正在为轮次 ${roundId} 开奖...`)
  
  return new Promise((resolve, reject) => {
    // 1. 获取轮次信息和所有参与者
    db.get("SELECT prize_amount FROM rounds WHERE id = ?", [roundId], (err, round) => {
      if (err) return reject(err)
      
      db.all("SELECT user_address FROM participants WHERE round_id = ?", [roundId], async (err, rows) => {
        if (err) return reject(err)
        
        let winner = "无人参与"
        if (rows.length > 0) {
          const randomIndex = Math.floor(Math.random() * rows.length)
          winner = rows[randomIndex].user_address
          
          // 执行链上转账
          try {
            console.log(`准备向中奖者 ${winner} 转账 ${round.prize_amount} 代币...`)
            const decimals = 18; // 默认 18，或者调用 tokenContract.decimals()
            const amount = ethers.parseUnits(round.prize_amount.toString(), decimals)
            
            const tx = await tokenContract.transfer(winner, amount)
            console.log(`转账交易已发送: ${tx.hash}`)
            await tx.wait()
            console.log(`转账确认成功！`)
          } catch (txErr) {
            console.error(`转账失败:`, txErr)
            // 即使转账失败，我们也记录中奖者，但可能需要人工介入或重试机制
          }
        }

        // 2. 更新轮次状态
        db.run(
          "UPDATE rounds SET status = 'completed', winner_address = ? WHERE id = ?",
          [winner, roundId],
          (err) => {
            if (err) reject(err)
            else {
              console.log(`轮次 ${roundId} 结束，中奖者: ${winner}`)
              resolve(winner)
            }
          }
        )
      })
    })
  })
}

// 每分钟检查一次是否需要开奖
cron.schedule("* * * * *", async () => {
  db.get("SELECT * FROM rounds WHERE status = 'active' ORDER BY id DESC LIMIT 1", async (err, round) => {
    if (round) {
      const now = new Date()
      const endTime = new Date(round.end_time)
      if (now >= endTime) {
        await drawWinner(round.id)
        await getOrCreateActiveRound() // 开启下一轮
      }
    } else {
      await getOrCreateActiveRound()
    }
  })
})


// 管理员登录
app.post("/api/admin/login", (req, res) => {
  const { user, pass } = req.body
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    res.json({ success: true, token: "admin-secret-token" }) // 实际开发应使用 JWT
  } else {
    res.status(401).json({ error: "账号或密码错误" })
  }
})

// 手动调整当前轮次奖金
app.post("/api/admin/update-prize", (req, res) => {
  const { token, amount } = req.body
  if (token !== "admin-secret-token") return res.status(403).json({ error: "无权限" })
  
  const addAmount = parseInt(amount)
  if (isNaN(addAmount)) return res.status(400).json({ error: "金额无效" })

  db.get("SELECT id FROM rounds WHERE status = 'active' ORDER BY id DESC LIMIT 1", (err, round) => {
    if (err || !round) return res.status(500).json({ error: "未找到活跃轮次" })
    
    // 同时增加总奖池和独立的分红奖池记录
    db.run("UPDATE rounds SET prize_amount = prize_amount + ?, bonus_amount = bonus_amount + ? WHERE id = ?", [addAmount, addAmount, round.id], (err) => {
      if (err) return res.status(500).json({ error: err.message })
      res.json({ success: true, message: `奖池已增加 ${addAmount}` })
    })
  })
})

// --- API 接口 ---

// 获取公共配置信息
app.get("/api/config", (req, res) => {
  res.json({
    token_address: TOKEN_ADDRESS,
    collection_address: COLLECTION_ADDRESS
  })
})

// 获取当前轮次信息（前端调用）
app.get("/api/current-round", async (req, res) => {
  try {
    const round = await getOrCreateActiveRound()
    db.all("SELECT user_address, created_at FROM participants WHERE round_id = ? ORDER BY id DESC", [round.id], (err, participants) => {
      res.json({
        ...round,
        participant_count: participants.length,
        recent_participants: participants.slice(0, 10) // 只返回最近10个
      })
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 获取往期中奖列表
app.get("/api/history", (req, res) => {
  db.all("SELECT id, winner_address, prize_amount, end_time FROM rounds WHERE status = 'completed' ORDER BY id DESC LIMIT 20", (err, rows) => {
    res.json(rows)
  })
})

// 提交参与信息
app.post("/api/participate", (req, res) => {
  const { round_id, user_address, tx_hash } = req.body
  if (!round_id || !user_address || !tx_hash) {
    return res.status(400).json({ error: "参数不全" })
  }

  const now = new Date().toISOString()
  
  // 1. 校验该地址在此轮是否已经参与过
  db.get(
    "SELECT id FROM participants WHERE round_id = ? AND user_address = ?",
    [round_id, user_address.toLowerCase()],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (row) return res.status(400).json({ error: "您在本轮已助力过，请等待下一轮开始" });

      // 2. 开启事务处理：记录参与者并增加奖池
      db.serialize(() => {
        db.run("BEGIN TRANSACTION")

        db.run(
          "INSERT INTO participants (round_id, user_address, tx_hash, created_at) VALUES (?, ?, ?, ?)",
          [round_id, user_address.toLowerCase(), tx_hash, now],
          function(err) {
            if (err) {
              db.run("ROLLBACK")
              if (err.message.includes("UNIQUE")) return res.status(400).json({ error: "交易哈希已存在" })
              return res.status(500).json({ error: err.message })
            }

            // 核心逻辑：奖池递增 10,000
            db.run(
              "UPDATE rounds SET prize_amount = prize_amount + 10000 WHERE id = ?",
              [round_id],
              (err) => {
                if (err) {
                  db.run("ROLLBACK")
                  return res.status(500).json({ error: err.message })
                }
                db.run("COMMIT")
                res.json({ success: true, id: this.lastID })
              }
            )
          }
        )
      })
    }
  )
})

app.listen(PORT, () => {
  console.log(`后端服务运行在 http://localhost:${PORT}`)
  getOrCreateActiveRound() // 启动时确保有活跃轮次
})