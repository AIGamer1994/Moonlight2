import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getDatabase, ref, get, remove, runTransaction, onValue } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { APP_VERSION, APP_BUILD_DATE, APP_CHANGELOG } from "./version.js";

    const firebaseConfig = {
      apiKey: "AIzaSyDPSKUIlpu-DXATWSe__zUixRQh41BTJM0",
      authDomain: "tictactoe-online-65492.firebaseapp.com",
      databaseURL: "https://tictactoe-online-65492-default-rtdb.firebaseio.com",
      projectId: "tictactoe-online-65492",
      storageBucket: "tictactoe-online-65492.firebasestorage.app",
      messagingSenderId: "63333498074",
      appId: "1:63333498074:web:96df3c361d589ec422b9e3"
    };
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const database = getDatabase(app);
    const roomRoot = "rooms";
    const cardInfo = {
      1: { name: "星空斥候", effect: "猜一位玩家手牌的身分，猜中使對方本輪出局。不能猜星光斥候。", copies: 5 },
      2: { name: "觀星使者", effect: "私下查看一位玩家的手牌，不可公開其身分。", copies: 2 },
      3: { name: "星夜決鬥家", effect: "與一位玩家比較手牌點數，較小者本輪出局。", copies: 2 },
      4: { name: "銀月守衛", effect: "保護自己直到下次抽牌前，其他玩家的卡牌效果對你無效。", copies: 2 },
      5: { name: "月色魔法師", effect: "指定一位玩家（可選自己）棄掉手牌，並從牌堆抽一張新牌。", copies: 2 },
      6: { name: "月光騎士", effect: "與一位玩家交換手牌。", copies: 1 },
      7: { name: "滿月女王", effect: "若兩張手牌總和達 12 點或以上，必須打出此牌。", copies: 1 },
      8: { name: "月亮公主", effect: "棄掉此牌時，立即出局。", copies: 1 }
    };
    const cardLabel = rank => `「${cardInfo[rank]?.name || "未知手牌"}」（${rank} 點）`;
    const forcedSevenIndex = cards =>
      cards?.length === 2 && cards.includes(7) && cards[0] + cards[1] >= 12
        ? cards.indexOf(7)
        : -1;
    const elements = {
      lobby: document.querySelector("#lobby"),
      room: document.querySelector("#room"),
      roomInput: document.querySelector("#room-input"),
      create: document.querySelector("#create-room"),
      join: document.querySelector("#join-room"),
      roomCode: document.querySelector("#room-code"),
      roomContent: document.querySelector("#room-content"),
      notice: document.querySelector("#notice"),
      noticeText: document.querySelector("#notice-text"),
      notificationToggle: document.querySelector("#notification-toggle"),
      versionBadge: document.querySelector("#app-version"),
      versionText: document.querySelector("#version-text")
    };
    let user = auth.currentUser;
    let roomCode = null;
    let roomRef = null;
    let unsubscribe = null;
    let currentRoom = null;
    let mySeat = null;
    let busy = false;
    let aiBusy = false;
    let aiTimer = null;
    let selectedCardIndex = null;
    let selectedTarget = "";
    let selectedGuess = "3";
    let randomTargetSelected = false;
    let leaveConfirmOpen = false;
    let leaveIntent = "leave";
    let roomRemovalInProgress = false;
    let modalStep = null;
    let discardDrawerOpen = false;
    let resultQueue = [];
    let notifiedActionIds = new Set();
    let pendingRoundAward = null;
    let loadedFirstRoomSnapshot = false;
    const notificationPreferenceKey = "moonlit-mail-action-notifications";
    const getStoredItem = (storage, key) => {
      try { return storage.getItem(key); } catch { return null; }
    };
    const setStoredItem = (storage, key, value) => {
      try { storage.setItem(key, value); } catch {}
    };
    let actionNotificationsEnabled = getStoredItem(localStorage, notificationPreferenceKey) !== "off";

    const clone = value => JSON.parse(JSON.stringify(value));
    const seatIds = ["p0", "p1", "p2", "p3"];
    const playerName = seatId => `玩家${seatIds.indexOf(seatId) + 1}`;
    const displayPlayerName = seatId => seatId === mySeat ? "你" : playerName(seatId);
    const playerAvatar = (seatId, player) => player.bot
      ? "🤖"
      : ["👩🏻‍🚀", "👨🏽‍🚀", "🧑🏼‍🚀", "👩🏿‍🚀"][seatIds.indexOf(seatId)];
    const markOwnPlayerName = message => mySeat
      ? message.replaceAll(`${playerName(mySeat)}（你）`, "你").replaceAll(playerName(mySeat), "你")
      : message;
    const roomKey = code => `moonlit_${code}`;
    const clientId = (() => {
      const key = "moonlit-mail-client-id";
      let id = getStoredItem(sessionStorage, key);
      if (!id) {
        id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setStoredItem(sessionStorage, key, id);
      }
      return id;
    })();

    function showNotice(message, info = false) {
      elements.noticeText.textContent = message;
      elements.notice.classList.toggle("info", info);
      elements.notice.style.display = "flex";
    }

    function clearNotice() {
      elements.noticeText.textContent = "";
      elements.notice.style.display = "none";
    }

    function scrollToPageBottom() {
      requestAnimationFrame(() => {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
      });
    }

    function setBusy(value, action = "") {
      busy = value;
      elements.create.disabled = value;
      elements.join.disabled = value;
      if (value) {
        if (action === "create") elements.create.textContent = "連線建立中...";
        if (action === "join") elements.join.textContent = "加入中...";
      } else {
        elements.create.textContent = "建立新郵局";
        elements.join.textContent = "加入";
      }
    }

    async function ensureSignedIn() {
      if (!user) user = (await signInAnonymously(auth)).user;
      return user;
    }

    async function recordGamePageView() {
      try {
        await ensureSignedIn();
        const counterRef = ref(database, "siteStats/gameLinkClicks");
        const result = await runTransaction(counterRef, count =>
          typeof count === "number" ? count + 1 : 1
        );
        if (!result.committed) {
          throw new Error("Firebase 沒有提交瀏覽次數。");
        }
      } catch (error) {
        console.error("無法記錄遊戲頁面瀏覽次數：", error);
      }
    }

    function newLobby(uid) {
      return {
        phase: "lobby",
        hostUid: uid,
        hostClientId: clientId,
        createdAt: Date.now(),
        players: {
          p0: { uid, clientId, name: playerName("p0"), bot: false, tokens: 0 }
        }
      };
    }

    function listenToRoom(code, seatId, targetRoomRef = ref(database, `${roomRoot}/${roomKey(code)}`)) {
      if (unsubscribe) unsubscribe();
      roomCode = code;
      roomRef = targetRoomRef;
      mySeat = seatId;
      selectedCardIndex = null;
      selectedTarget = "";
      modalStep = null;
      resultQueue = [];
      notifiedActionIds = new Set();
      pendingRoundAward = null;
      loadedFirstRoomSnapshot = false;
      document.body.classList.add("in-room");
      elements.roomCode.textContent = code;
      elements.lobby.classList.add("hidden");
      elements.room.classList.remove("hidden");
      clearNotice();
      unsubscribe = onValue(roomRef, snapshot => {
        const room = snapshot.val();
        if (!room) {
          leaveRoom();
          if (!roomRemovalInProgress) showNotice("這間郵局已不存在，請建立新房間。");
          return;
        }
        const shouldScrollToBottom = (currentRoom?.phase === "lobby" && room.phase === "playing") ||
          (currentRoom?.phase === "roundOver" && room.phase === "playing") ||
          (currentRoom?.phase === "playing" && ["roundOver", "finished"].includes(room.phase));
        if (room.round) {
          const newRound = room.round.number !== currentRoom?.round?.number;
          let latestActionResult = null;
          const action = room.round.lastAction;
          if (actionNotificationsEnabled && loadedFirstRoomSnapshot && action?.id && action.id !== currentRoom?.round?.lastAction?.id) {
            latestActionResult = { id: `action:${action.id}`, action, eliminationDetails: "" };
            resultQueue.push(latestActionResult);
            notifiedActionIds.add(action.id);
          }
          if (actionNotificationsEnabled && room.round.out?.[mySeat] && (newRound || !currentRoom?.round?.out?.[mySeat])) {
            if (latestActionResult) latestActionResult.viewerEliminated = true;
            const detail = room.round.outDetails?.[mySeat];
            const isFinalHandElimination = detail?.how?.includes(" 最終手牌是");
            const explanation = detail?.how ? `原因：${detail.how}。` : "";
            const eliminationDetails = detail?.by
              ? isFinalHandElimination
                ? detail.how
                : detail.by === playerName(mySeat)
                  ? `你被自己的效果淘汰。${explanation}`
                  : `${detail.by} 淘汰了 ${playerName(mySeat)}。${explanation}`
              : `${playerName(mySeat)} 本輪出局。${explanation}`;
            if (isFinalHandElimination) {
              latestActionResult && (latestActionResult.eliminationDetails = "");
            } else if (latestActionResult?.action?.rank === 3 && detail?.how?.startsWith("比牌時手牌較小")) {
              latestActionResult.eliminationDetails = "";
            } else if (latestActionResult) {
              latestActionResult.eliminationDetails = eliminationDetails;
            } else {
              resultQueue.push({ id: `out:${room.round.number}:${mySeat}`, eliminationDetails });
            }
          }
          if (loadedFirstRoomSnapshot &&
              currentRoom?.round?.number === room.round.number &&
              currentRoom.phase === "playing" &&
              ["roundOver", "finished"].includes(room.phase)) {
            if (actionNotificationsEnabled && action?.id && !notifiedActionIds.has(action.id)) {
              resultQueue.unshift({ id: `action:${action.id}`, action, eliminationDetails: "" });
              notifiedActionIds.add(action.id);
            }
            const finalHandResults = room.round.finalHandResults;
            if (actionNotificationsEnabled && finalHandResults && Object.keys(finalHandResults).length) {
              resultQueue.push({
                id: `final-hands:${room.round.number}`,
                finalHandResults: Object.values(finalHandResults)
              });
            }
            if (actionNotificationsEnabled) {
              pendingRoundAward = {
                id: `round-award:${room.round.number}`,
                roundAward: true,
                winnerSeat: room.round.winnerSeats?.[0]
              };
              queuePendingRoundAward();
            }
          }
          if (!loadedFirstRoomSnapshot) {
            loadedFirstRoomSnapshot = true;
          }
          normalizeRound(room);
        }
        currentRoom = room;
        renderRoom(room);
        if (shouldScrollToBottom) scrollToPageBottom();
        maybePlayAI(room);
      }, error => showNotice(`無法接收房間更新：${error.message}`));
    }

    function playerIds(room) {
      return seatIds.filter(id => room.players?.[id]);
    }

    function activeIds(room) {
      return playerIds(room).filter(id => !room.round?.out?.[id]);
    }

    function asList(value) {
      if (Array.isArray(value)) return value.filter(item => item != null);
      if (value && typeof value === "object") {
        return Object.keys(value)
          .sort((a, b) => Number(a) - Number(b))
          .map(key => value[key])
          .filter(item => item != null);
      }
      return [];
    }

    function normalizeRound(room) {
      room.round.deck = asList(room.round.deck);
      room.round.pending = asList(room.round.pending);
      room.round.discards = asList(room.round.discards);
      room.round.log = asList(room.round.log);
      room.round.turnOrder = asList(room.round.turnOrder);
    }

    function queuePendingRoundAward() {
      if (!actionNotificationsEnabled) {
        pendingRoundAward = null;
        return;
      }
      if (resultQueue.length > 0) return;
      if (pendingRoundAward) {
        resultQueue.push(pendingRoundAward);
        pendingRoundAward = null;
      }
    }

    function startRound(room) {
      const deck = [];
      for (const [rank, card] of Object.entries(cardInfo)) {
        for (let count = 0; count < card.copies; count += 1) deck.push(Number(rank));
      }
      for (let i = deck.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }

      const setAside = deck.pop();
      const ids = playerIds(room);
      const hands = {};
      const out = {};
      const shields = {};
      for (const id of ids) {
        hands[id] = deck.pop();
        out[id] = false;
        shields[id] = false;
      }
      room.roundNumber = (room.roundNumber || 0) + 1;
      room.phase = "playing";
      room.round = {
        number: room.roundNumber,
        turnOrder: ids,
        currentSeat: ids[0],
        turnNumber: 0,
        setAside,
        deck,
        hands,
        out,
        shields,
        pending: [],
        discards: [],
        privateMessages: {},
        log: [`第 ${room.roundNumber} 封信開始寄送。`]
      };
      drawForCurrent(room);
    }

    function drawForCurrent(room) {
      const round = room.round;
      const seat = round.currentSeat;
      round.turnNumber += 1;
      const drawn = round.deck.pop();
      const held = round.hands[seat];
      round.pending = [held, drawn];
      round.hands[seat] = null;
      if (round.shields[seat]) {
        round.shields[seat] = false;
        round.log.push(`${playerName(seat)} 的守護在新回合收起。`);
      }
    }

    function awardRound(room) {
      const round = room.round;
      const remaining = activeIds(room);
      const best = Math.max(...remaining.map(id => round.hands[id] || 0));
      const tied = remaining.filter(id => (round.hands[id] || 0) === best);
      const start = Math.max(0, round.turnOrder.indexOf(round.currentSeat));
      const priority = round.turnOrder.slice(start).concat(round.turnOrder.slice(0, start));
      const winner = priority.find(id => tied.includes(id));
      room.players[winner].tokens = (room.players[winner].tokens || 0) + 1;
      round.outDetails ||= {};
      for (const loser of remaining) {
        if (loser === winner) continue;
        round.out[loser] = true;
        const finalHandResult = tied.includes(loser)
          ? `${playerName(loser)} 最終手牌是${cardLabel(round.hands[loser])}，與 ${playerName(winner)} 最終手牌是${cardLabel(round.hands[winner])} 同點，依回合順序判定勝出。`
          : `${playerName(loser)} 最終手牌是${cardLabel(round.hands[loser])}，被 ${playerName(winner)} ${cardLabel(round.hands[winner])} 比下去。`;
        round.outDetails[loser] = {
          by: playerName(winner),
          how: finalHandResult
        };
        round.finalHandResults ||= {};
        round.finalHandResults[loser] = finalHandResult;
        round.log.push(finalHandResult);
      }
      round.log.push(`恭喜 ${playerName(winner)} 獲得一枚月光印記！✨`);
      round.winnerSeats = [winner];
      round.winningRank = best;
      const champion = playerIds(room).find(id => room.players[id].tokens >= 3);
      room.phase = champion ? "finished" : "roundOver";
      if (champion) room.winnerSeat = champion;
    }

    function nextTurn(room) {
      const round = room.round;
      const active = activeIds(room);
      if (active.length <= 1) {
        if (active.length === 1 && round.hands[active[0]] == null) round.hands[active[0]] = round.pending?.[0] ?? null;
        awardRound(room);
        return;
      }
      const currentIndex = round.turnOrder.indexOf(round.currentSeat);
      for (let offset = 1; offset <= round.turnOrder.length; offset += 1) {
        const next = round.turnOrder[(currentIndex + offset) % round.turnOrder.length];
        if (!round.out[next]) {
          round.currentSeat = next;
          break;
        }
      }
      if (round.deck.length === 0) {
        awardRound(room);
        return;
      }
      drawForCurrent(room);
    }

    function takeOut(room, target, attacker = "", how = "") {
      const round = room.round;
      if (round.shields[target]) {
        round.shields[target] = false;
        round.log.push(`${playerName(target)} 的守護擋下了這次效果。`);
        return false;
      }
      round.out[target] = true;
      round.outDetails ||= {};
      round.outDetails[target] = {
        by: attacker ? playerName(attacker) : "",
        how
      };
      round.log.push(attacker
        ? `${playerName(attacker)} 淘汰了 ${playerName(target)}。原因：${how}`
        : `${playerName(target)} 出局。原因：${how}`);
      return true;
    }

    function fallbackTransaction(baseRoom, updater) {
      let usedSnapshot = false;
      return runTransaction(roomRef, room => {
        if (!room) {
          if (usedSnapshot) return;
          usedSnapshot = true;
          room = clone(baseRoom);
        } else {
          room = clone(room);
        }
        return updater(room);
      });
    }

    async function createRoom() {
      if (busy) return;
      setBusy(true, "create");
      clearNotice();
      try {
        await ensureSignedIn();
        let code = "";
        let created = false;
        for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
          code = String(Math.floor(100000 + Math.random() * 900000));
          const result = await runTransaction(ref(database, `${roomRoot}/${roomKey(code)}`), room => {
            if (room !== null) return;
            return newLobby(user.uid);
          });
          created = result.committed;
        }
        if (!created) throw new Error("暫時無法建立房間，請再試一次。");
        listenToRoom(code, "p0");
      } catch (error) {
        showNotice(`建立房間失敗：${error.message}`);
      } finally {
        setBusy(false);
      }
    }

    async function joinRoom() {
      if (busy) return;
      const code = elements.roomInput.value.trim();
      if (!/^\d{6}$/.test(code)) {
        showNotice("請輸入 6 位數字的房間代碼。");
        return;
      }
      setBusy(true, "join");
      clearNotice();
      try {
        await ensureSignedIn();
        let targetRef = ref(database, `${roomRoot}/${roomKey(code)}`);
        let snapshot = await get(targetRef);
        if (!snapshot.exists()) {
          const legacyRef = ref(database, `${roomRoot}/${code}`);
          const legacySnapshot = await get(legacyRef);
          if (!legacySnapshot.exists()) {
            throw new Error("找不到這間郵局，請確認代碼是否正確，並確認建立房間的分頁沒有使用舊版網頁。");
          }
          targetRef = legacyRef;
          snapshot = legacySnapshot;
        }
        let joinedSeat = null;
        let issue = "full";
        let usedSnapshot = false;
        const result = await runTransaction(targetRef, room => {
          joinedSeat = null;
          issue = "full";
          if (!room) {
            if (usedSnapshot) return;
            usedSnapshot = true;
            room = clone(snapshot.val());
          } else {
            room = clone(room);
          }
          const existingSeat = playerIds(room).find(id =>
            room.players[id].uid === user.uid &&
            room.players[id].clientId === clientId &&
            !room.players[id].bot
          );
          if (existingSeat) {
            joinedSeat = existingSeat;
            return room;
          }
          if (room.phase !== "lobby") {
            issue = "started";
            return;
          }
          const free = seatIds.find(id => !room.players?.[id]);
          if (!free) return;
          room.players[free] = { uid: user.uid, clientId, name: playerName(free), bot: false, tokens: 0 };
          joinedSeat = free;
          return room;
        });
        if (!result.committed || !joinedSeat) {
          if (issue === "started") throw new Error("遊戲已經開始，這個房間目前不能加入。");
          throw new Error("房間已滿，無法再加入。");
        }
        listenToRoom(code, joinedSeat, targetRef);
      } catch (error) {
        showNotice(`加入房間失敗：${error.message}`);
      } finally {
        setBusy(false);
      }
    }

    async function addBot() {
      if (!currentRoom || busy) return;
      setBusy(true);
      clearNotice();
      try {
        const operationId = `${user.uid}-${Date.now()}-${Math.random()}`;
        const result = await fallbackTransaction(currentRoom, room => {
          if (room.phase !== "lobby" || room.hostUid !== user.uid || room.hostClientId !== clientId) return;
          if (playerIds(room).some(id => room.players[id].operationId === operationId)) return room;
          const free = seatIds.find(id => !room.players?.[id]);
          if (!free) return;
          room.players[free] = {
            uid: `bot-${free}-${room.createdAt}`,
            name: playerName(free),
            bot: true,
            tokens: 0,
            operationId
          };
          return room;
        });
        if (!result.committed) showNotice("目前無法加入 AI，請確認這是大廳且還有空位。");
      } catch (error) {
        showNotice(`加入 AI 失敗：${error.message}`);
      } finally {
        setBusy(false);
        if (currentRoom) renderRoom(currentRoom);
      }
    }

    async function removeBot(seat) {
      if (!currentRoom || busy) return;
      setBusy(true);
      clearNotice();
      try {
        const result = await fallbackTransaction(currentRoom, room => {
          if (room.phase !== "lobby" || room.hostUid !== user.uid || room.hostClientId !== clientId ||
              !room.players?.[seat]?.bot) return;
          delete room.players[seat];
          return room;
        });
        if (!result.committed) showNotice("無法移除 AI，請確認仍在大廳且你是房主。");
      } catch (error) {
        showNotice(`移除 AI 失敗：${error.message}`);
      } finally {
        setBusy(false);
        if (currentRoom) renderRoom(currentRoom);
      }
    }

    async function startGame() {
      if (!currentRoom || busy) return;
      setBusy(true);
      clearNotice();
      try {
        const result = await fallbackTransaction(currentRoom, room => {
          if (room.phase !== "lobby" || room.hostUid !== user.uid || room.hostClientId !== clientId || playerIds(room).length < 2) return;
          startRound(room);
          return room;
        });
        if (!result.committed) showNotice("開始遊戲需要房主操作，且至少要有 2 位玩家。");
      } catch (error) {
        showNotice(`無法開始遊戲：${error.message}`);
      } finally {
        setBusy(false);
        if (currentRoom) renderRoom(currentRoom);
      }
    }

    function applyCard(room, seat, rank, target, action) {
      const round = room.round;
      const actor = playerName(seat);
      const targetName = target ? playerName(target) : "";
      const targetRequired = [1, 2, 3, 5, 6].includes(rank);
      let discardedRank = null;
      if (targetRequired && (!target || !room.players[target] || round.out[target])) return false;

      if (rank === 1) {
        if (Number(action) < 2 || Number(action) > 8 || Number(action) === 1) return false;
        if (round.shields[target]) {
          round.shields[target] = false;
          round.log.push(`${targetName} 的守護擋下了猜測效果，沒有被淘汰。`);
        } else {
          const correct = round.hands[target] === Number(action);
          if (correct) {
            takeOut(room, target, seat,
              `猜牌命中「${cardInfo[action].name}」（${action} 點）`);
          } else {
            round.log.push(`${actor} 猜測 ${targetName} 是「${cardInfo[action].name}」（${action} 點），猜錯了。`);
          }
        }
      } else if (rank === 2) {
        if (round.shields[target]) {
          round.shields[target] = false;
          round.log.push(`${targetName} 的守護擋下了查看手牌效果。`);
        } else {
          round.privateMessages ||= {};
          round.revealedHands ||= {};
          round.revealedHands[target] = {
            viewer: seat,
            rank: round.hands[target]
          };
          round.privateMessages[seat] = `${targetName} 的手牌是${cardLabel(round.hands[target])}。`;
          round.log.push(`${actor} 私下查看了 ${targetName} 的手牌。`);
        }
      } else if (rank === 3) {
        if (round.shields[target]) {
          round.shields[target] = false;
          round.log.push(`${targetName} 的守護擋下了決鬥，沒有進行比牌。`);
        } else {
          const own = round.hands[seat];
          const theirs = round.hands[target];
          if (own !== theirs) {
            const eliminated = own < theirs ? seat : target;
            const eliminatedRank = round.hands[eliminated];
            const attacker = eliminated === seat ? target : seat;
            takeOut(room, eliminated, attacker,
              `比牌時手牌較小（${eliminatedRank} 點）`);
          } else {
            round.log.push(`${actor} 和 ${targetName} 的手牌點數相同，無人出局。`);
          }
        }
      } else if (rank === 4) {
        round.shields[seat] = true;
        round.log.push(`${actor} 進入守護狀態，直到下次抽牌前免受其他玩家的卡牌效果。`);
      } else if (rank === 5) {
        const discarded = round.hands[target];
        if (target !== seat && round.shields[target]) {
          round.shields[target] = false;
          round.log.push(`${targetName} 的守護擋下了棄牌效果。`);
        } else if (discarded != null) {
          discardedRank = discarded;
          round.discards.push({ seat: target, rank: discarded });
          const discardedCard = `「${cardInfo[discarded]?.name || "未知手牌"}」（${discarded} 點）`;
          if (discarded === 8) {
            round.out[target] = true;
            round.outDetails ||= {};
            round.outDetails[target] = { by: playerName(seat), how: `${cardInfo[5].name}迫使你棄掉 8 號月亮公主` };
            round.log.push(`${actor} 淘汰了 ${targetName}：${cardInfo[5].name}迫使其棄掉 ${discardedCard}。`);
          } else if (round.deck.length) {
            round.hands[target] = round.deck.pop();
            round.log.push(`${actor} 令 ${targetName} 棄掉 ${discardedCard} 並抽取新牌。`);
          } else {
            round.hands[target] = null;
            round.log.push(`${actor} 令 ${targetName} 棄掉 ${discardedCard}；郵袋已空，無牌可抽。`);
          }
        } else {
          round.log.push(`${targetName} 沒有可棄掉的手牌。`);
        }
      } else if (rank === 6) {
        if (round.shields[target]) {
          round.shields[target] = false;
          round.log.push(`${targetName} 的守護擋下了交換手牌效果。`);
        } else {
          [round.hands[seat], round.hands[target]] = [round.hands[target], round.hands[seat]];
          round.privateMessages ||= {};
          round.privateMessages[seat] = `新交換的手牌：${cardLabel(round.hands[seat])}。`;
          round.privateMessages[target] = `新交換的手牌：${cardLabel(round.hands[target])}。`;
          round.log.push(`${actor} 和 ${targetName} 交換了手牌。`);
        }
      } else if (rank === 7) {
        round.log.push(`${actor} 棄掉「${cardInfo[7].name}」（7 點）。`);
      } else if (rank === 8) {
        round.out[seat] = true;
        round.outDetails ||= {};
        round.outDetails[seat] = { by: "", how: "自己棄掉 8 號月亮公主" };
        round.log.push(`${actor} 棄掉月亮公主，立即出局。`);
      } else {
        return false;
      }
      const result = createActionResult(room, seat, rank, target, action, discardedRank);
      round.lastAction = result;
      return true;
    }

    function createActionResult(room, seat, rank, target, action, discardedRank = null) {
      const round = room.round;
      const actor = playerName(seat);
      const targetName = target ? playerName(target) : "";
      let publicText = "";
      const privateTexts = {};
      if (rank === 1) {
        const correct = round.hands[target] === Number(action);
        const blocked = (round.log[round.log.length - 1] || "").includes("守護擋下了猜測效果");
        publicText = blocked
          ? `${actor} 打出 ${cardLabel(1)}，${targetName} 的守護擋下猜測效果，沒有被淘汰。`
          : correct
            ? round.out[target]
              ? `${actor} 打出 ${cardLabel(1)}，淘汰了 ${targetName}。原因：猜中其手牌是${cardLabel(action)}。`
              : `${actor} 打出 ${cardLabel(1)}，猜中 ${targetName} 的手牌，但效果未能淘汰對方。`
            : `${actor} 打出 ${cardLabel(1)}，猜測 ${targetName} 的手牌是${cardLabel(action)}，猜錯了。`;
      } else if (rank === 2) {
        const blocked = (round.log[round.log.length - 1] || "").includes("守護擋下了查看手牌效果");
        publicText = blocked
          ? `${actor} 打出 ${cardLabel(2)}，${targetName} 的守護擋下查看手牌效果。`
          : `${actor} 打出 ${cardLabel(2)}，查看 ${targetName} 的手牌。`;
        if (!blocked) {
          privateTexts[seat] = round.privateMessages?.[seat] || `${targetName} 的手牌是${cardLabel(round.hands[target])}。`;
        }
      } else if (rank === 3) {
        const own = round.hands[seat];
        const theirs = round.hands[target];
        const eliminated = own < theirs ? seat : own > theirs ? target : "";
        const targetLog = round.log[round.log.length - 1] || "";
        const handsCompared = `${playerName(seat)} 的手牌是${cardLabel(own)}，${targetName} 的手牌是${cardLabel(theirs)}`;
        publicText = targetLog.includes("守護擋下了決鬥")
          ? `${actor} 打出 ${cardLabel(3)}，${targetName} 的守護擋下決鬥，沒有進行比牌。`
          : own === theirs
            ? `${actor} 打出 ${cardLabel(3)}與 ${targetName} 比牌，平手，無人淘汰。`
            : `${actor} 打出 ${cardLabel(3)}與 ${targetName} 比牌，${playerName(eliminated)} 的手牌是${cardLabel(round.hands[eliminated])}，${playerName(eliminated === seat ? target : seat)} 淘汰了 ${playerName(eliminated)}。`;
        if (!targetLog.includes("守護擋下了決鬥")) {
          const privateComparison = own === theirs
            ? `${actor} 與 ${targetName} 比牌。\n${handsCompared}。\n平手，無人淘汰。`
            : `${actor} 與 ${targetName} 比牌。\n${handsCompared}。\n${playerName(eliminated === seat ? target : seat)} 淘汰了 ${playerName(eliminated)}。`;
          privateTexts[seat] = privateComparison;
          privateTexts[target] = privateComparison;
        }
      } else if (rank === 4) {
        publicText = `${actor} 打出 ${cardLabel(4)}，受到保護直到下次抽牌。`;
      } else if (rank === 5) {
        const targetLog = round.log[round.log.length - 1] || "";
        publicText = round.out[target]
          ? `${actor} 打出 ${cardLabel(5)}，${targetName} 棄掉${cardLabel(discardedRank)}，被淘汰。`
          : targetLog.includes("守護擋下")
            ? `${actor} 打出 ${cardLabel(5)}，${targetName} 的守護擋下效果。`
            : targetLog.includes("沒有可棄掉")
                ? `${actor} 打出 ${cardLabel(5)}，但 ${targetName} 沒有可更換的手牌。`
                : targetLog.includes("郵袋已空")
                  ? `${actor} 打出 ${cardLabel(5)}，${targetName} 棄掉${cardLabel(discardedRank)}，但郵袋已空，沒有新牌可抽。`
                  : `${actor} 打出 ${cardLabel(5)}，${targetName} 棄掉${cardLabel(discardedRank)}並抽取新牌。`;
      } else if (rank === 6) {
        const blocked = (round.log[round.log.length - 1] || "").includes("守護擋下了交換手牌效果");
        publicText = blocked
          ? `${actor} 打出 ${cardLabel(6)}，${targetName} 的守護擋下交換手牌效果。`
          : `${actor} 打出 ${cardLabel(6)}，與 ${targetName} 交換了手牌。`;
        if (!blocked) {
          privateTexts[seat] = round.privateMessages?.[seat] || "";
          privateTexts[target] = round.privateMessages?.[target] || "";
        }
      } else if (rank === 7) {
        publicText = `${actor} 打出 ${cardLabel(7)}。`;
      } else if (rank === 8) {
        publicText = `${actor} 打出 ${cardLabel(8)}，立即出局。`;
      }
      return {
        id: `${round.number}:${round.turnNumber}:${seat}`,
        rank,
        actor: seat,
        target,
        cardName: cardInfo[rank].name,
        publicText,
        privateTexts
      };
    }

    function logPlayedCard(round, seat, rank) {
      round.log.push(`${playerName(seat)} 打出「${cardInfo[rank].name}」（${rank} 點）。`);
    }

    async function playSelectedCard() {
      if (!currentRoom || busy || selectedCardIndex == null) return;
      const rank = currentRoom.round.pending[selectedCardIndex];
      if (forcedSevenIndex(currentRoom.round.pending) !== -1 && rank !== 7) {
        showNotice("兩張手牌總和達 12 點或以上，必須打出滿月女王。");
        return;
      }
      const target = selectedTarget;
      const targetRequired = [1, 2, 3, 5, 6].includes(rank);
      if (targetRequired && !target) {
        showNotice("請先選擇效果目標。");
        return;
      }
      if (rank === 1 && (!selectedGuess || Number(selectedGuess) < 2 || Number(selectedGuess) > 8)) {
        showNotice("請選擇 2 至 8 點的猜測，不能猜 1 點。");
        return;
      }
      setBusy(true);
      clearNotice();
      try {
        const base = currentRoom;
        const result = await fallbackTransaction(base, room => {
          if (room.phase !== "playing" || room.round.currentSeat !== mySeat) return;
          if (room.players[mySeat]?.uid !== user.uid || room.players[mySeat]?.clientId !== clientId || room.round.out[mySeat]) return;
          normalizeRound(room);
          const hand = room.round.pending;
          if (!Array.isArray(hand) || hand.length !== 2 || hand[selectedCardIndex] !== rank) return;
          if (forcedSevenIndex(hand) !== -1 && rank !== 7) return;
          const kept = hand[1 - selectedCardIndex];
          room.round.discards.push({ seat: mySeat, rank });
          room.round.hands[mySeat] = kept;
          room.round.pending = [];
          logPlayedCard(room.round, mySeat, rank);
          if (!applyCard(room, mySeat, rank, target, selectedGuess)) return;
          if (activeIds(room).length <= 1 || room.round.deck.length === 0) {
            awardRound(room);
          } else {
            nextTurn(room);
          }
          return room;
        });
        if (!result.committed) showNotice("這張牌無法打出，請確認目前輪到你，並重新選擇。");
      } catch (error) {
        showNotice(`出牌失敗：${error.message}`);
      } finally {
        selectedCardIndex = null;
        selectedTarget = "";
        randomTargetSelected = false;
        modalStep = null;
        setBusy(false);
        if (currentRoom) renderRoom(currentRoom);
      }
    }

    async function nextRound() {
      if (!currentRoom || busy) return;
      setBusy(true);
      clearNotice();
      try {
        const result = await fallbackTransaction(currentRoom, room => {
          if (room.phase !== "roundOver" || room.players[mySeat]?.uid !== user.uid || room.players[mySeat]?.clientId !== clientId) return;
          startRound(room);
          return room;
        });
        if (!result.committed) showNotice("只有人類玩家可開始下一封信。");
      } catch (error) {
        showNotice(`無法開始下一輪：${error.message}`);
      } finally {
        setBusy(false);
        if (currentRoom) renderRoom(currentRoom);
      }
    }

    async function replayGame() {
      if (!currentRoom || busy) return;
      setBusy(true);
      clearNotice();
      try {
        const result = await fallbackTransaction(currentRoom, room => {
          const player = room.players?.[mySeat];
          if (room.phase !== "finished" || player?.uid !== user.uid || player?.clientId !== clientId ||
              playerIds(room).length < 2) return;
          for (const seat of playerIds(room)) {
            room.players[seat].tokens = 0;
          }
          room.roundNumber = 0;
          delete room.winnerSeat;
          startRound(room);
          return room;
        });
        if (!result.committed) showNotice("無法開始新的一局，請確認你仍在房間內且至少有 2 位玩家。");
        else {
          resultQueue = [];
          pendingRoundAward = null;
          notifiedActionIds = new Set();
        }
      } catch (error) {
        showNotice(`無法再來一局：${error.message}`);
      } finally {
        setBusy(false);
        if (currentRoom) renderRoom(currentRoom);
      }
    }

    function aiChoice(room) {
      const round = room.round;
      const seat = round.currentSeat;
      const cards = asList(round.pending);
      if (cards.length !== 2 || cards.some(rank => !cardInfo[rank])) {
        throw new Error("AI 的待選手牌資料無效，請確認牌局同步後再試。");
      }
      const opponents = activeIds(room).filter(id => id !== seat);
      const forcedIndex = forcedSevenIndex(cards);
      const chooseIndex = forcedIndex !== -1
        ? forcedIndex
        : cards.length === 2
          ? (cards[0] === 8 ? 1 : cards[1] === 8 ? 0 : cards[0] <= cards[1] ? 0 : 1)
          : 0;
      const rank = cards[chooseIndex];
      let target = opponents[0] || "";
      if (rank === 5) {
        target = [...activeIds(room)].sort((a, b) => (round.hands[a] || 0) - (round.hands[b] || 0))[0] || "";
      }
      if ([3, 6].includes(rank)) {
        target = opponents.sort((a, b) => (round.hands[a] || 0) - (round.hands[b] || 0))[0] || "";
      }
      if (rank === 1) {
        target = opponents.sort((a, b) => (round.hands[b] || 0) - (round.hands[a] || 0))[0] || "";
      }
      return { chooseIndex, rank, target, action: 2 + Math.floor(Math.random() * 7) };
    }

    function maybePlayAI(room) {
      if (room.phase !== "playing" || aiBusy || !room.round?.currentSeat) return;
      const seat = room.round.currentSeat;
      if (!room.players[seat]?.bot) return;
      const roundNumber = room.round.number;
      const turnNumber = room.round.turnNumber;
      const actionKey = `${roomCode}:${roundNumber}:${turnNumber}:${seat}`;
      if (maybePlayAI.lastKey === actionKey) return;
      maybePlayAI.lastKey = actionKey;
      aiBusy = true;
      aiTimer = setTimeout(async () => {
        let retryScheduled = false;
        try {
          const choice = aiChoice(currentRoom);
          const result = await fallbackTransaction(currentRoom, game => {
            if (game.phase !== "playing" || game.round.number !== roundNumber ||
                game.round.turnNumber !== turnNumber || game.round.currentSeat !== seat ||
                !game.players[seat]?.bot) return;
            normalizeRound(game);
            const hand = game.round.pending;
            if (!Array.isArray(hand) || hand.length !== 2) return;
            const kept = hand[1 - choice.chooseIndex];
            game.round.discards.push({ seat, rank: choice.rank });
            game.round.hands[seat] = kept;
            game.round.pending = [];
            logPlayedCard(game.round, seat, choice.rank);
            if (!applyCard(game, seat, choice.rank, choice.target, choice.action)) return;
            if (activeIds(game).length <= 1 || game.round.deck.length === 0) {
              awardRound(game);
            } else {
              nextTurn(game);
            }
            return game;
          });
          if (!result.committed && currentRoom?.phase === "playing" &&
              currentRoom.round?.number === roundNumber &&
              currentRoom.round?.turnNumber === turnNumber &&
              currentRoom.round?.currentSeat === seat) {
            throw new Error("AI 出牌交易未提交，請稍後重試。");
          }
        } catch (error) {
          showNotice(`AI 出牌失敗：${error.message}`);
          if (currentRoom?.phase === "playing" && currentRoom.round?.number === roundNumber &&
              currentRoom.round?.turnNumber === turnNumber && currentRoom.round?.currentSeat === seat) {
            maybePlayAI.lastKey = null;
            retryScheduled = true;
            aiTimer = setTimeout(() => maybePlayAI(currentRoom), 2000);
          }
        } finally {
          aiBusy = false;
          if (!retryScheduled && currentRoom?.phase === "playing") maybePlayAI(currentRoom);
        }
      }, 2000);
    }

    function renderRoster(room, isHost = false) {
      return `<div class="roster">${seatIds.map((id, index) => {
        const player = room.players?.[id];
        if (!player) return `<div class="seat"><div class="avatar">·</div><div><div class="seat-name">空位 ${index + 1}</div><div class="seat-meta">等待玩家加入</div></div></div>`;
        const isCurrent = room.phase === "playing" && room.round.currentSeat === id;
        const isOut = room.round?.out?.[id];
        return `<div class="seat${isCurrent ? " current" : ""}${isOut ? " out" : ""}">
          <div class="avatar">${playerAvatar(id, player)}</div>
          <div class="seat-content"><div><div class="seat-name">${displayPlayerName(id)}</div>
          <div class="seat-meta">${player.bot ? "AI 郵差" : "玩家"}${isOut ? " · 本輪出局" : ""}</div></div>
          ${isHost && room.phase === "lobby" && player.bot ? `<button class="button light small remove-bot-button" data-remove-bot="${id}" aria-label="移除${playerName(id)}" title="移除${playerName(id)}" ${busy ? "disabled" : ""}>−</button>` : ""}</div>
        </div>`;
      }).join("")}</div>`;
    }

    function renderLobby(room) {
      const ids = playerIds(room);
      const isHost = room.hostUid === user.uid && room.hostClientId === clientId;
      return `<div>
        <div class="status">郵局已準備好，邀請朋友或加入 AI 郵差吧。</div>
        ${renderRoster(room, isHost)}
        <p class="help">開始遊戲前，房間至少要有 2 位玩家，最多 4 位。</p>
        ${isHost ? `<div class="lobby-controls">
          <button id="add-ai" class="button light" ${ids.length >= 4 || busy ? "disabled" : ""}>加入 AI 郵差</button>
          <button id="start-game" class="button" ${ids.length < 2 || busy ? "disabled" : ""}>開始送信</button>
        </div>` : `<p class="help">等待房主開始遊戲。你可以先把房間代碼分享給朋友。</p>`}
      </div>`;
    }

    function renderRules() {
      return Object.entries(cardInfo).map(([rank, card]) =>
        `<article class="rule-card"><strong>${rank}｜${escapeHtml(card.name)}（${card.copies} 張）</strong><p>${escapeHtml(card.effect)}</p></article>`
      ).join("");
    }

    const rulesModal = document.querySelector("#rules-modal");
    const openRules = () => {
      document.querySelector("#rules-list").innerHTML = renderRules();
      rulesModal.classList.remove("hidden");
    };
    document.querySelector("#open-rules").addEventListener("click", openRules);
    document.querySelector("#open-room-rules").addEventListener("click", openRules);
    document.querySelector("#close-rules").addEventListener("click", () => rulesModal.classList.add("hidden"));
    rulesModal.addEventListener("click", event => {
      if (event.target === rulesModal) rulesModal.classList.add("hidden");
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") rulesModal.classList.add("hidden");
    });

    function renderDiscardDrawer(round) {
      if (!discardDrawerOpen) return "";
      const discards = asList(round.discards).filter(item => item && cardInfo[item.rank]).reverse();
      return `<div class="drawer-backdrop" id="drawer-backdrop"></div>
        <aside class="discard-drawer" aria-label="已出牌記錄">
          <div class="drawer-header"><h3>本輪已打出的牌</h3><button class="button light small" id="close-discard-drawer">關閉</button></div>
          <ul class="discard-list">${discards.map(item => `<li>
            <span class="discard-rank">${item.rank}</span>
            <span><strong>${cardInfo[item.rank].name}</strong><br><span class="seat-meta">${item.rank} 點</span></span>
            <span class="discard-owner">${playerName(item.seat)}</span>
          </li>`).join("") || "<li>本輪還沒有牌被打出。</li>"}</ul>
        </aside>`;
    }

    function renderActionResultModal(result) {
      if (!result) return "";
      if (result.roundAward) {
        return `<div class="modal-backdrop" id="action-result-backdrop">
          <section class="modal elimination-modal" role="dialog" aria-modal="true" aria-labelledby="action-result-title">
            <h3 id="action-result-title">🎉 本輪送出心意成功！</h3>
            <p>恭喜 ${escapeHtml(markOwnPlayerName(playerName(result.winnerSeat)))} 獲得一枚月光印記！✨</p>
            <div class="modal-actions"><button class="button" id="dismiss-round-result">太好了</button></div>
          </section>
        </div>`;
      }
      if (result.finalHandResults) {
        return `<div class="modal-backdrop" id="action-result-backdrop">
          <section class="modal elimination-modal" role="dialog" aria-modal="true" aria-labelledby="action-result-title">
            <h3 id="action-result-title">最終手牌比大小</h3>
            ${result.finalHandResults.map(message => `<p>${escapeHtml(markOwnPlayerName(message))}</p>`).join("")}
            <div class="modal-actions"><button class="button" id="dismiss-round-result">繼續</button></div>
          </section>
        </div>`;
      }
      const action = result.action;
      const actionReportsOwnElimination = Boolean(
        action &&
        result.eliminationDetails &&
        ((action.target === mySeat && [1, 5].includes(action.rank)) ||
          (action.actor === mySeat && action.rank === 8))
      );
      const actionMessage = markOwnPlayerName(actionReportsOwnElimination
        ? ""
        : action
          ? action.privateTexts?.[mySeat] || action.publicText || `${playerName(action.actor)} 打出了「${action.cardName}」。`
          : "");
      const eliminationDetails = markOwnPlayerName(result.eliminationDetails || "");
      const messages = [actionMessage, eliminationDetails].filter(Boolean);
      const messageLines = messages.flatMap(message => message.split("\n"));
      return `<div class="modal-backdrop" id="action-result-backdrop">
        <section class="modal elimination-modal" role="dialog" aria-modal="true" aria-labelledby="action-result-title">
          <h3 id="action-result-title">${action && result.viewerEliminated ? "出局" : result.eliminationDetails ? "本輪出局" : "出牌結果"}</h3>
          ${messageLines.map(message => `<p>${escapeHtml(message)}</p>`).join("")}
          <div class="modal-actions"><button class="button" id="dismiss-round-result">知道了</button></div>
        </section>
      </div>`;
    }

    function renderActionBox(room, rank) {
      const needsTarget = [1, 2, 3, 5, 6].includes(rank);
      if (modalStep === "target" && needsTarget) {
        const choices = activeIds(room).filter(id => {
          if ([1, 2, 3].includes(rank)) return id !== mySeat;
          if (rank === 5) return true;
          return id !== mySeat;
        });
        return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <h3 id="modal-title">選擇一位玩家</h3>
          <p>你打出「${cardInfo[rank].name}」，要對哪位玩家使用？</p>
          <div class="modal-options">${choices.map(id => `<button class="modal-option" data-target-seat="${id}">${displayPlayerName(id)}${room.players[id].bot ? " · AI" : ""}${room.round.shields?.[id] ? " · 守護中" : ""}</button>`).join("")}</div>
          ${choices.length ? `<button class="modal-option random-target" id="random-target">🎲 隨機選一位玩家</button>` : ""}
          <div class="modal-actions"><button class="button light small" id="modal-cancel">取消出牌</button></div>
        </section></div>`;
      }
      if (modalStep !== "action") return "";
      const actionText = {
        1: `選擇猜測 ${selectedTarget ? playerName(selectedTarget) : "目標玩家"} 的手牌身分。猜中對方本輪出局。`,
        2: `私下查看 ${selectedTarget ? playerName(selectedTarget) : "目標玩家"} 的手牌，不可告訴其他玩家。`,
        3: `與 ${selectedTarget ? playerName(selectedTarget) : "目標玩家"} 私下比較手牌點數，較小者本輪出局。`,
        4: "保護自己，直到下次抽牌前，其他玩家的卡牌效果對你無效。",
        5: `令 ${selectedTarget ? playerName(selectedTarget) : "目標玩家"}（可選自己）棄掉手牌並抽一張新牌。`,
        6: `與 ${selectedTarget ? playerName(selectedTarget) : "目標玩家"} 交換手牌。`,
        7: "若兩張手牌總和達 12 點或以上，必須打出此牌。",
        8: "棄掉此牌會令你立即出局。"
      }[rank];
      const guessChoices = rank === 1
        ? `<div class="modal-options guess-options">${Object.keys(cardInfo).filter(value => Number(value) >= 2).map(value =>
            `<button class="modal-option${selectedGuess === value ? " selected" : ""}" data-guess-rank="${value}">${value} · ${cardInfo[value].name}（未出 ${Math.max(0, cardInfo[value].copies - asList(room.round.discards).filter(card => card.rank === Number(value)).length)} 張）</button>`
          ).join("")}</div>`
        : "";
      return `<div class="modal-backdrop"><section class="modal${rank === 1 ? " guess-modal" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h3 id="modal-title">選擇行動</h3>
        <p>${actionText}</p>
        ${guessChoices}
        <div class="modal-actions">
          ${needsTarget
            ? `<button class="button light small" id="modal-back">返回選擇玩家</button>`
            : `<button class="button light small" id="modal-cancel">取消出牌</button>`}
          ${rank === 1 ? "" : `<button class="button" id="play-card">確認並出牌</button>`}
        </div>
      </section></div>`;
    }

    function renderGame(room) {
      const round = room.round;
      const ids = playerIds(room);
      const myTurn = room.phase === "playing" && round.currentSeat === mySeat &&
        room.players[mySeat]?.uid === user.uid &&
        room.players[mySeat]?.clientId === clientId;
      const isAI = room.players[round.currentSeat]?.bot;
      const status = room.phase === "roundOver"
        ? "本輪完成！手牌點數最高的玩家獲得月光印記。"
        : room.phase === "finished"
          ? `🎉 恭喜 ${markOwnPlayerName(playerName(room.winnerSeat))} 成為月夜傳說！🌙`
          : isAI
            ? `${playerName(round.currentSeat)} 正在斟酌要寄出的信…`
            : myTurn ? "輪到你了：選一張牌開始出牌。" : `等待 ${playerName(round.currentSeat)} 寄出下一封信…`;
      const ownHand = round.hands[mySeat];
      const revealedHand = round.revealedHands?.[mySeat];
      const viewedHandNote = revealedHand
        ? `<p class="help">${escapeHtml(displayPlayerName(revealedHand.viewer))} 曾查看你的${cardLabel(revealedHand.rank)}。</p>`
        : "";
      const privateMessageMarkup = round.privateMessages?.[mySeat]
        ? `<p class="help">${escapeHtml(round.privateMessages[mySeat])}</p>`
        : "";
      const forcedSevenCardIndex = forcedSevenIndex(round.pending);
      const handMarkup = myTurn && round.pending?.length === 2
        ? `<section class="hand-area">
          <div class="hand-title"><span>你的手牌</span><span class="private-card">只有你能看得見</span></div>
          <div class="hand">${round.pending.map((rank, index) => `<button class="playing-card${selectedCardIndex === index ? " selected" : ""}" data-card-index="${index}" ${forcedSevenCardIndex !== -1 && index !== forcedSevenCardIndex ? "disabled" : ""}>
            <span class="card-rank">${rank}</span><span class="card-name">${cardInfo[rank].name}</span><span class="card-effect">${cardInfo[rank].effect}</span>
          </button>`).join("")}</div>
          <p class="help" style="margin-top:10px">剛抽到：${cardLabel(round.pending[1])}。</p>
          ${forcedSevenCardIndex !== -1 ? `<p class="help">兩張手牌總和達 12 點或以上，必須打出滿月女王。</p>` : ""}
          ${viewedHandNote}
          ${privateMessageMarkup}
        </section>`
        : ownHand != null
          ? `<section class="hand-area">
            <div class="hand-title"><span>你的手牌</span><span class="private-card">只有你看得見</span></div>
            <div class="hand"><div class="playing-card">
              <span class="card-rank">${ownHand}</span><span class="card-name">${cardInfo[ownHand]?.name || "未知手牌"}</span>
              <span class="card-effect">${cardInfo[ownHand]?.effect || ""}</span>
            </div></div>
            ${viewedHandNote}
            ${privateMessageMarkup}
          </section>`
          : `<section class="hand-area"><div class="hand-title"><span>${myTurn ? "等待抽牌…" : "你的手牌"}</span><span class="private-card">只有你看得見</span></div><p class="help">${myTurn ? "郵差正在取出信件。" : "你目前沒有可顯示的手牌。"}</p></section>`;
      const log = asList(round.log).reverse();
      return `<div class="game-area">
        <div class="score-strip"><span class="round-pill">第 ${round.number} 封信</span><div class="pile-controls">
          <span class="deck-count">牌庫剩 ${asList(round.deck).length} 張</span>
          <button class="button light small" id="show-discard-pile">出牌堆</button>
        </div></div>
        <div class="status" aria-live="polite">${status}</div>
        <div class="player-list">${ids.map(id => {
          const player = room.players[id];
          const isOut = round.out[id];
          const isCurrent = round.currentSeat === id && room.phase === "playing";
          const tokenCount = Math.max(0, Math.min(player.tokens || 0, 3));
          const moon = ["🌑", "🌒", "🌓", "🌕"][tokenCount];
          return `<div class="player-line${isCurrent ? " turn" : ""}${isOut ? " eliminated" : ""}">
            <div class="player-main"><div class="avatar">${playerAvatar(id, player)}</div><div><div class="seat-name">${displayPlayerName(id)}</div><div class="seat-meta">${isOut ? "本輪出局" : round.shields[id] ? "有守護" : player.bot ? "AI 郵差" : "手牌保密"}</div></div></div>
            <div class="player-score">${moon}<br><span class="seat-meta">${tokenCount} / 3</span></div>
          </div>`;
        }).join("")}</div>
        ${handMarkup}
        <div class="discard"><strong>遊戲紀錄（可上下捲動）</strong><ul class="log">${log.map(line => `<li>${escapeHtml(markOwnPlayerName(line))}</li>`).join("") || "<li>還沒有信件送出。</li>"}</ul></div>
        ${room.phase === "roundOver" && room.players[mySeat]?.uid === user.uid && room.players[mySeat]?.clientId === clientId ? `<button class="button" id="next-round">開始下一封信</button>` : ""}
        ${room.phase === "finished" ? `<button class="button" id="replay-game" ${busy ? "disabled" : ""}>再來一局</button>` : ""}
      </div>${renderDiscardDrawer(round)}${renderActionResultModal(resultQueue[0])}${!resultQueue.length && myTurn && selectedCardIndex != null && round.pending?.[selectedCardIndex] != null
        ? renderActionBox(room, round.pending[selectedCardIndex])
        : ""}`;
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      })[character]);
    }

    function renderRoom(room) {
      const leaveConfirmation = leaveConfirmOpen
        ? `<div class="modal-backdrop" id="leave-confirm-backdrop">
            <section class="modal elimination-modal" role="dialog" aria-modal="true" aria-labelledby="leave-confirm-title">
              <h3 id="leave-confirm-title">${leaveIntent === "return" ? "返回大廳" : leaveIntent === "disband" ? "解散房間" : "離開房間"}</h3>
              <p>${leaveIntent === "return" || leaveIntent === "disband"
                ? "這會刪除整間郵局，所有玩家都會返回各自的大廳。確定繼續嗎？"
                : "確定要離開這間郵局嗎？"}</p>
              <div class="modal-actions">
                <button class="button light small" id="cancel-leave">繼續遊戲</button>
                <button class="button" id="confirm-leave">${leaveIntent === "return" ? "返回大廳" : leaveIntent === "disband" ? "解散房間" : "確認離開"}</button>
              </div>
            </section>
          </div>`
        : "";
      elements.roomContent.innerHTML = (room.phase === "lobby" ? renderLobby(room) : renderGame(room)) + leaveConfirmation;
      document.body.classList.toggle("waiting-room", room.phase === "lobby");
      const isHost = room.hostUid === user.uid && room.hostClientId === clientId;
      const leaveButton = document.querySelector("#leave-room");
      leaveButton.textContent = isHost ? "解散房間" : "離開房間";
      leaveButton.setAttribute("aria-label", isHost ? "解散房間" : "離開房間");
      elements.roomContent.querySelector("#add-ai")?.addEventListener("click", addBot);
      elements.roomContent.querySelector("#start-game")?.addEventListener("click", startGame);
      elements.roomContent.querySelector("#next-round")?.addEventListener("click", nextRound);
      elements.roomContent.querySelector("#replay-game")?.addEventListener("click", replayGame);
      elements.roomContent.querySelector("#return-lobby")?.addEventListener("click", () => {
        leaveIntent = "return";
        leaveConfirmOpen = true;
        renderRoom(currentRoom);
      });
      elements.roomContent.querySelector("#cancel-leave")?.addEventListener("click", () => {
        leaveConfirmOpen = false;
        leaveIntent = "leave";
        renderRoom(currentRoom);
      });
      elements.roomContent.querySelector("#confirm-leave")?.addEventListener("click", confirmRoomExit);
      elements.roomContent.querySelectorAll("[data-remove-bot]").forEach(button => {
        button.addEventListener("click", () => removeBot(button.dataset.removeBot));
      });
      elements.roomContent.querySelector("#show-discard-pile")?.addEventListener("click", () => {
        discardDrawerOpen = true;
        renderRoom(currentRoom);
      });
      const closeDiscardDrawer = () => {
        discardDrawerOpen = false;
        renderRoom(currentRoom);
      };
      elements.roomContent.querySelector("#close-discard-drawer")?.addEventListener("click", closeDiscardDrawer);
      elements.roomContent.querySelector("#drawer-backdrop")?.addEventListener("click", closeDiscardDrawer);
      elements.roomContent.querySelectorAll("[data-card-index]").forEach(button => {
        button.addEventListener("click", () => {
          selectedCardIndex = Number(button.dataset.cardIndex);
          selectedTarget = "";
          selectedGuess = "3";
          randomTargetSelected = false;
          const rank = currentRoom.round.pending[selectedCardIndex];
          modalStep = [1, 2, 3, 5, 6].includes(rank) ? "target" : "action";
          renderRoom(currentRoom);
          scrollToPageBottom();
        });
      });
      elements.roomContent.querySelectorAll("[data-target-seat]").forEach(button => {
        button.addEventListener("click", () => {
          selectedTarget = button.dataset.targetSeat;
          if ([2, 3, 5].includes(currentRoom.round.pending[selectedCardIndex])) {
            playSelectedCard();
            return;
          }
          modalStep = "action";
          renderRoom(currentRoom);
          scrollToPageBottom();
        });
      });
      elements.roomContent.querySelector("#random-target")?.addEventListener("click", () => {
        const targets = [...elements.roomContent.querySelectorAll("[data-target-seat]")];
        if (!targets.length) return;
        const target = targets[Math.floor(Math.random() * targets.length)];
        const rank = currentRoom.round.pending[selectedCardIndex];
        if ([1, 2, 3].includes(rank)) {
          selectedTarget = target.dataset.targetSeat;
          randomTargetSelected = true;
          if (rank === 1) selectedGuess = "";
          modalStep = "action";
          renderRoom(currentRoom);
          scrollToPageBottom();
        } else {
          target.click();
        }
      });
      elements.roomContent.querySelectorAll("[data-guess-rank]").forEach(button => {
        button.addEventListener("click", () => {
          selectedGuess = button.dataset.guessRank;
          playSelectedCard();
        });
      });
      elements.roomContent.querySelector("#modal-cancel")?.addEventListener("click", () => {
        selectedCardIndex = null;
        selectedTarget = "";
        randomTargetSelected = false;
        modalStep = null;
        renderRoom(currentRoom);
      });
      elements.roomContent.querySelector("#modal-back")?.addEventListener("click", () => {
        randomTargetSelected = false;
        selectedGuess = "3";
        modalStep = [1, 2, 3, 5, 6].includes(currentRoom.round.pending[selectedCardIndex]) ? "target" : "action";
        renderRoom(currentRoom);
        scrollToPageBottom();
      });
      elements.roomContent.querySelector("#play-card")?.addEventListener("click", playSelectedCard);
      const dismissRoundResult = () => {
        resultQueue.shift();
        queuePendingRoundAward();
        renderRoom(currentRoom);
      };
      elements.roomContent.querySelector("#dismiss-round-result")?.addEventListener("click", dismissRoundResult);
      elements.roomContent.querySelectorAll(".modal-backdrop").forEach(backdrop => {
        backdrop.addEventListener("click", event => {
          if (event.target !== event.currentTarget) return;
          if (event.currentTarget.id === "action-result-backdrop") {
            resultQueue.shift();
            queuePendingRoundAward();
          } else if (event.currentTarget.id === "leave-confirm-backdrop") {
            leaveConfirmOpen = false;
            leaveIntent = "leave";
          } else {
            selectedCardIndex = null;
            selectedTarget = "";
            randomTargetSelected = false;
            modalStep = null;
          }
          renderRoom(currentRoom);
        });
      });
    }

    function leaveRoom() {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      if (aiTimer) clearTimeout(aiTimer);
      aiTimer = null;
      aiBusy = false;
      roomCode = null;
      roomRef = null;
      currentRoom = null;
      mySeat = null;
      randomTargetSelected = false;
      leaveConfirmOpen = false;
      leaveIntent = "leave";
      maybePlayAI.lastKey = null;
      document.body.classList.remove("in-room");
      elements.room.classList.add("hidden");
      elements.lobby.classList.remove("hidden");
      elements.roomContent.replaceChildren();
    }

    async function confirmRoomExit() {
      if (!currentRoom || !roomRef) return;
      const removingRoom = leaveIntent !== "leave";
      const isHost = currentRoom.hostUid === user.uid && currentRoom.hostClientId === clientId;
      if (removingRoom && !isHost) {
        showNotice("只有房主可以解散房間或返回大廳。");
        return;
      }
      if (!removingRoom) {
        leaveRoom();
        return;
      }
      const targetRef = roomRef;
      const confirmedIntent = leaveIntent;
      roomRemovalInProgress = true;
      try {
        await remove(targetRef);
        leaveRoom();
        showNotice(confirmedIntent === "return" ? "房間已刪除，你已返回大廳。" : "房間已解散，所有玩家已返回大廳。", true);
      } catch (error) {
        showNotice(`無法刪除房間：${error.message}`);
      } finally {
        roomRemovalInProgress = false;
      }
    }

    async function copyCode() {
      try {
        await navigator.clipboard.writeText(roomCode);
        showNotice("房間代碼已複製，傳給朋友吧！", true);
      } catch {
        showNotice(`請手動複製房間代碼：${roomCode}`, true);
      }
    }

    elements.create.addEventListener("click", createRoom);
    elements.join.addEventListener("click", joinRoom);
    elements.roomInput.addEventListener("keydown", event => {
      if (event.key === "Enter") joinRoom();
    });
    document.querySelector("#copy-code").addEventListener("click", copyCode);
    const syncNotificationToggle = () => {
      elements.notificationToggle.setAttribute("aria-pressed", String(actionNotificationsEnabled));
      elements.notificationToggle.classList.toggle("is-on", actionNotificationsEnabled);
      elements.notificationToggle.classList.toggle("is-off", !actionNotificationsEnabled);
      elements.notificationToggle.title = `彈出通知${actionNotificationsEnabled ? "開啟" : "關閉"}，點擊切換`;
    };
    syncNotificationToggle();
    recordGamePageView();
    elements.notificationToggle.addEventListener("click", () => {
      actionNotificationsEnabled = !actionNotificationsEnabled;
      setStoredItem(localStorage, notificationPreferenceKey, actionNotificationsEnabled ? "on" : "off");
      if (!actionNotificationsEnabled) {
        resultQueue = [];
        pendingRoundAward = null;
      }
      queuePendingRoundAward();
      syncNotificationToggle();
      if (currentRoom) renderRoom(currentRoom);
    });
    document.querySelector("#leave-room").addEventListener("click", () => {
      leaveIntent = currentRoom?.hostUid === user.uid && currentRoom?.hostClientId === clientId
        ? "disband"
        : "leave";
      leaveConfirmOpen = true;
      renderRoom(currentRoom);
    });

    if (elements.versionText) {
      elements.versionText.textContent = APP_VERSION;
    }
    if (elements.versionBadge) {
      elements.versionBadge.title = `月光郵局 ${APP_VERSION} (${APP_BUILD_DATE}) - 點擊查看更新說明`;
      elements.versionBadge.addEventListener("click", () => {
        showNotice(`版本 ${APP_VERSION} (${APP_BUILD_DATE})：${APP_CHANGELOG}`, true);
      });
    }

    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("error", event => {
        console.error("月光郵局全域錯誤：", event.error || event.message);
        if (elements.notice) showNotice(`系統提示：${event.message || event.error}`);
      });
      window.addEventListener("unhandledrejection", event => {
        console.error("月光郵局非同步異常：", event.reason);
        if (elements.notice) showNotice(`連線提示：${event.reason?.message || event.reason}`);
      });
    }

    // 鎖定第 1 頁（大廳）滑動與手勢縮放
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("touchmove", event => {
        if (!document.body.classList.contains("in-room")) {
          // 允許規則彈窗與輸入框正常操作，其餘區域完全禁止滑動
          if (!event.target.closest("#rules-modal, .rules-modal, #rules-list, input")) {
            event.preventDefault();
          }
        }
      }, { passive: false });

      document.addEventListener("gesturestart", event => event.preventDefault());
      document.addEventListener("gesturechange", event => event.preventDefault());
      document.addEventListener("gestureend", event => event.preventDefault());
    }

    console.log("🌙 月光郵局遊戲腳本已成功載入！版本：", APP_VERSION);