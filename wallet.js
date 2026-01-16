let currentAccount = null
let TOKEN_ADDRESS = "";
let COLLECTION_ADDRESS = "";
// 生产环境 API 地址
const API_BASE = "https://api.snowkoi.top/api";
let currentRound = null;

async function fetchConfig() {
    try {
        const res = await fetch(`${API_BASE}/config`);
        const config = await res.json();
        TOKEN_ADDRESS = config.token_address;
        COLLECTION_ADDRESS = config.collection_address;
        console.log("配置加载成功:", config);
    } catch (e) {
        console.error("加载配置失败:", e);
    }
}
const ERC20_ABI = [
    {
        "constant": true,
        "inputs": [{"name": "_owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "balance", "type": "uint256"}],
        "type": "function"
    },
    {
        "constant": true,
        "inputs": [],
        "name": "decimals",
        "outputs": [{"name": "", "type": "uint8"}],
        "type": "function"
    }
];

function shortenAddress(a){return a?a.slice(0,6)+"..."+a.slice(-4):""}
function updateButton(addr){const b=document.querySelector(".wallet-btn");if(!b)return;if(addr){const s=shortenAddress(addr);b.textContent=s;b.title=addr;b.setAttribute("data-address",addr)}else{b.textContent="连接钱包";b.removeAttribute("data-address");b.removeAttribute("title");updateBalanceDisplay("0.00")}}

function updateBalanceDisplay(amount) {
    const el = document.querySelector(".balance-amount");
    if (el) el.innerHTML = `${amount} <span class="currency">SNOWKOI</span>`;
}

async function switchNetworkToBSC() {
    if (!window.ethereum) return;
    const chainId = '0x38'; // BSC Mainnet
    try {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: chainId }],
        });
    } catch (switchError) {
        // This error code indicates that the chain has not been added to MetaMask.
        if (switchError.code === 4902) {
            try {
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [
                        {
                            chainId: chainId,
                            chainName: 'Binance Smart Chain',
                            rpcUrls: ['https://bsc-dataseed.binance.org/'],
                            nativeCurrency: {
                                name: 'BNB',
                                symbol: 'BNB',
                                decimals: 18
                            },
                            blockExplorerUrls: ['https://bscscan.com/']
                        },
                    ],
                });
            } catch (addError) {
                console.error(addError);
            }
        }
    }
}

async function getTokenBalance(address) {
    if (!window.ethereum || !address) return "0.00";
    try {
        const data = "0x70a08231000000000000000000000000" + address.slice(2).toLowerCase();
        const balanceHex = await window.ethereum.request({
            method: 'eth_call',
            params: [{ to: TOKEN_ADDRESS, data: data }, "latest"]
        });
        const balanceWei = BigInt(balanceHex);
        const divisor = 10n ** 18n;
        const integerPart = balanceWei / divisor;
        const fractionalPart = balanceWei % divisor;
        let fractionStr = fractionalPart.toString().padStart(18, '0').slice(0, 2);
        return `${integerPart}.${fractionStr}`;
    } catch (e) {
        return "0.00";
    }
}

// --- 新增：后端对接与助力功能 ---

async function fetchCurrentRound() {
    try {
        const res = await fetch(`${API_BASE}/current-round`);
        const data = await res.json();
        currentRound = data;
        updateLotteryUI(data);
        checkParticipationStatus(data); // 检查当前用户是否已参与
    } catch (e) {
        console.error("获取轮次信息失败", e);
    }
}

function checkParticipationStatus(data) {
    const boostBtn = document.querySelector(".boost-btn");
    if (!boostBtn) return;

    if (currentAccount && data.recent_participants) {
        const hasParticipated = data.recent_participants.some(
            p => p.user_address.toLowerCase() === currentAccount.toLowerCase()
        );

        if (hasParticipated) {
            boostBtn.textContent = "已助力";
            boostBtn.classList.add("disabled");
            boostBtn.style.backgroundColor = "#ccc";
            boostBtn.style.cursor = "not-allowed";
        } else {
            boostBtn.textContent = "❄️ 助力雪球 ❄️";
            boostBtn.classList.remove("disabled");
            boostBtn.style.backgroundColor = ""; // 恢复 CSS 中的颜色
            boostBtn.style.cursor = "pointer";
        }
    }
}

function updateLotteryUI(data) {
    // 更新总奖池
    const totalPrizeEl = document.getElementById("total-prize");
    if (totalPrizeEl) totalPrizeEl.textContent = data.prize_amount.toLocaleString();

    // 更新分红奖池 (红色显示)
    const bonusPrizeEl = document.getElementById("bonus-prize");
    if (bonusPrizeEl) bonusPrizeEl.textContent = data.bonus_amount.toLocaleString();

    // 更新参与人数
    const countEl = document.getElementById("participant-count");
    const count = data.participant_count || 0;
    if (countEl) countEl.textContent = count.toLocaleString();

    // 根据人数切换图片
    const snowballImg = document.querySelector(".snowball-img");
    if (snowballImg) {
        let newSrc = "snow/雪团.png"; // 默认 0-2 人
        if (count >= 7) {
            newSrc = "snow/雪人.png";
        } else if (count >= 5) {
            newSrc = "snow/雪宝.png";
        } else if (count >= 3) {
            newSrc = "snow/雪球.png";
        }
        
        // 只有当路径变化时才更新，避免闪烁
        if (!snowballImg.src.endsWith(newSrc)) {
            snowballImg.src = newSrc;
            console.log(`参与人数达 ${count}，图片切换为: ${newSrc}`);
        }
    }

    // 更新倒计时
    updateCountdown(data.end_time);

    // 更新历史记录（可选）
    fetchHistory();
}

let countdownInterval = null;
function updateCountdown(endTimeStr) {
    if (countdownInterval) clearInterval(countdownInterval);
    const endTime = new Date(endTimeStr).getTime();

    const update = () => {
        const now = new Date().getTime();
        const diff = endTime - now;

        if (diff <= 0) {
            if (countdownInterval) clearInterval(countdownInterval);
            
            const nums = document.querySelectorAll(".countdown-timer .num");
            if (nums.length >= 3) {
                nums[0].textContent = "00";
                nums[1].textContent = "00";
                nums[2].textContent = "00";
            }

            console.log("倒计时结束，3秒后刷新轮次信息...");
            setTimeout(fetchCurrentRound, 3000); // 延迟刷新，避免死循环
            return;
        }

        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);

        const nums = document.querySelectorAll(".countdown-timer .num");
        if (nums.length >= 3) {
            nums[0].textContent = h.toString().padStart(2, '0');
            nums[1].textContent = m.toString().padStart(2, '0');
            nums[2].textContent = s.toString().padStart(2, '0');
        }
    };

    // 如果时间已到，直接执行并不启动定时器
    if (endTime - new Date().getTime() <= 0) {
        update();
    } else {
        update();
        countdownInterval = setInterval(update, 1000);
    }
}

async function fetchHistory() {
    try {
        const res = await fetch(`${API_BASE}/history`);
        const history = await res.json();
        
        // 更新滚动横幅
        const marqueeEl = document.querySelector(".marquee-content");
        if (marqueeEl && history.length > 0) {
            const latest = history[0];
            const addr = shortenAddress(latest.winner_address);
            marqueeEl.textContent = `🎊 恭喜地址 ${addr} 在第 ${latest.id} 轮中奖，获得 ${latest.prize_amount.toLocaleString()} SNOWKOI！`;
        }

        const listEl = document.querySelector(".history-list");
        if (listEl && history.length > 0) {
            listEl.innerHTML = history.map(item => `
                <div class="history-item">
                    <span class="address">${shortenAddress(item.winner_address)}</span>
                    <span class="prize">${item.prize_amount.toLocaleString()} SNOWKOI</span>
                </div>
            `).join("");
        }
    } catch (e) {}
}

async function boostSnowflake() {
    if (!currentAccount) {
        alert("请先连接钱包");
        return;
    }
    if (!currentRound) {
        alert("正在获取轮次信息，请稍后...");
        return;
    }

    // 增加前端拦截
    const boostBtn = document.querySelector(".boost-btn");
    if (boostBtn && boostBtn.classList.contains("disabled")) {
        alert("当前轮次已助力，请等待开奖！");
        return;
    }

    try {
        const amount = 10000n * (10n ** 18n); // 修改为 10,000 代币
        // 修正：内部拼接不需要 0x，只在最终 data 开头加一个 0x
        const amountHex = amount.toString(16).padStart(64, '0');
        const toAddress = COLLECTION_ADDRESS.toLowerCase().replace("0x", "").padStart(64, '0');
        const data = "0xa9059cbb" + toAddress + amountHex;

        const txHash = await window.ethereum.request({
            method: 'eth_sendTransaction',
            params: [{
                from: currentAccount,
                to: TOKEN_ADDRESS,
                data: data // 此时 data 是正确的 0xa9059cbb...
            }]
        });

        // 提交到后端
        const res = await fetch(`${API_BASE}/participate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                round_id: currentRound.id,
                user_address: currentAccount,
                tx_hash: txHash
            })
        });

        if (res.ok) {
            alert("助力成功！您的参与已记录。");
            fetchCurrentRound(); // 刷新数据
        } else {
            const err = await res.json();
            alert("提交失败: " + (err.error || "未知错误"));
        }
    } catch (e) {
        console.error("助力失败", e);
        alert("助力取消或失败");
    }
}

async function connectWallet(){const b=document.querySelector(".wallet-btn");if(!b)return;if(!window.ethereum){alert("未检测到钱包，请安装 MetaMask 或使用内置浏览器钱包");return}try{await switchNetworkToBSC();const accounts=await window.ethereum.request({method:"eth_requestAccounts"});currentAccount=accounts&&accounts[0]?accounts[0]:null;updateButton(currentAccount);if(currentAccount){const bal=await getTokenBalance(currentAccount);updateBalanceDisplay(bal)}}catch(e){alert("连接失败，请重试")}}
function disconnectWallet(){currentAccount=null;updateButton(null)}
async function checkExistingConnection(){if(!window.ethereum)return;try{const accounts=await window.ethereum.request({method:"eth_accounts"});currentAccount=accounts&&accounts[0]?accounts[0]:null;updateButton(currentAccount);if(currentAccount){await switchNetworkToBSC();const bal=await getTokenBalance(currentAccount);updateBalanceDisplay(bal)}}catch(e){}}
function setupEvents(){if(!window.ethereum)return;window.ethereum.on("accountsChanged",async acc=>{currentAccount=acc&&acc[0]?acc[0]:null;updateButton(currentAccount);if(currentAccount){const bal=await getTokenBalance(currentAccount);updateBalanceDisplay(bal)}else{updateBalanceDisplay("0.00")}});window.ethereum.on("chainChanged",_=>{window.location.reload()})}
document.addEventListener("DOMContentLoaded", async ()=>{
    const b=document.querySelector(".wallet-btn");
    if(b)b.addEventListener("click",()=>{
        if(currentAccount){disconnectWallet()}else{connectWallet()}
    });

    const boostBtn = document.querySelector(".boost-btn");
    if(boostBtn) boostBtn.addEventListener("click", boostSnowflake);

    // 优先加载配置
    await fetchConfig();

    checkExistingConnection();
    setupEvents();
    
    // 初始化轮次数据
    fetchCurrentRound();
    setInterval(fetchCurrentRound, 10000); // 每10秒同步一次数据
})
