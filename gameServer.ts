import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { log } from './index';

interface Player {
  ws: WebSocket;
  id: 1 | 2;
  keys: { up: boolean; down: boolean; left: boolean; right: boolean };
  selectedAbility?: string;
  abilityReady?: boolean;
  roomCode?: string;
}

interface Room {
  code: string;
  players: Player[];
  gameState: GameState | null;
  gameLoop: NodeJS.Timeout | null;
  spawnTimer: NodeJS.Timeout | null;
  gameMode: 'casual' | 'competitive';
  isQuickPlay: boolean;
  hostReady: boolean;
  guestReady: boolean;
  roundPaused: boolean;
  abilityTimers: NodeJS.Timeout[];
}

interface GameState {
  p1: PlayerState;
  p2: PlayerState;
  powerUps: PowerUpState[];
  mirages: MirageState[];
  voidWells: VoidWellState[];
  shake: number;
  flash: number;
  isPaused: boolean;
  gameActive: boolean;
  winner: string | null;
  gameMode: 'casual' | 'competitive';
  playersColliding: boolean;
}

interface EchoImpact {
  angle: number;
  force: number;
  time: number;
}

interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  score: number;
  dashReady: boolean;
  isDashing: boolean;
  isBlocking: boolean;
  recoil: boolean;
  speedMult: number;
  hasShield: boolean;
  isFrozen: boolean;
  isStunned: boolean;
  isMeteor: boolean;
  isGrid: boolean;
  isEchoActive: boolean;
  isEchoFrozen: boolean;
  isInfinityActive: boolean;
  isVesselActive: boolean;
  echoHistory: EchoImpact[];
  gridDirection: { dx: number; dy: number };
  color: string;
  name: string;
  selectedAbility?: string;
  abilityCooldown: number;
}

interface PowerUpState {
  id: number;
  x: number;
  y: number;
  type: string;
  color: string;
  pulse: number;
}

interface MirageState {
  id: number;
  owner: 1 | 2;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hitCooldown?: number;
}

interface VoidWellState {
  id: number;
  x: number;
  y: number;
  life: number;
  owner: 1 | 2;
}

const POWERUP_TYPES: { [key: string]: { color: string; name: string } } = {
  SPEED: { color: "#ffff00", name: "SPEED" },
  SIZE: { color: "#00ff00", name: "GROW" },
  SHIELD: { color: "#0000ff", name: "SHIELD" },
  FREEZE: { color: "#00ffff", name: "FREEZE" },
  WAVE: { color: "#ff0000", name: "WAVE" },
  VOID: { color: "#bf00ff", name: "VOID" },
  MIRROR: { color: "#ff00ff", name: "MIRROR" },
  METEOR: { color: "#ff8800", name: "METEOR" },
  GRID: { color: "#ffffff", name: "GRID" },
  ECHO: { color: "#00ff88", name: "ECHO" },
  BLITZ: { color: "#ff6600", name: "BLITZ" },
  INFINITY: { color: "#8B5CF6", name: "INFINITY" },
};

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 650;
const MAX_SCORE = 21;
const COMP_COOLDOWN = 600;

const rooms: Map<string, Room> = new Map();
const quickPlayQueue: Player[] = [];
let powerUpIdCounter = 0;
let mirageIdCounter = 0;
let voidWellIdCounter = 0;

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function createInitialGameState(mode: 'casual' | 'competitive'): GameState {
  return {
    p1: createPlayerState('#00f2ff', 'BLUE', 250),
    p2: createPlayerState('#ff0077', 'RED', 750),
    powerUps: [],
    mirages: [],
    voidWells: [],
    shake: 0,
    flash: 0,
    isPaused: false,
    gameActive: true,
    winner: null,
    gameMode: mode,
    playersColliding: false
  };
}

function createPlayerState(color: string, name: string, x: number): PlayerState {
  return {
    x, y: 325, vx: 0, vy: 0,
    radius: 20, mass: 1, score: 0,
    dashReady: true, isDashing: false, isBlocking: false, recoil: false,
    speedMult: 1, hasShield: false, isFrozen: false, isStunned: false,
    isMeteor: false, isGrid: false, isEchoActive: false, isEchoFrozen: false, isInfinityActive: false, isVesselActive: false,
    echoHistory: [],
    gridDirection: { dx: 0, dy: 0 },
    color, name,
    abilityCooldown: 0
  };
}

function broadcast(room: Room, message: object) {
  const data = JSON.stringify(message);
  room.players.forEach(player => {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  });
}

function sendToPlayer(player: Player, message: object) {
  if (player.ws.readyState === WebSocket.OPEN) {
    player.ws.send(JSON.stringify(message));
  }
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    log('New WebSocket connection', 'ws');
    let currentRoom: Room | null = null;
    let currentPlayer: Player | null = null;

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        
        switch (message.type) {
          case 'create_room': {
            const code = generateRoomCode();
            const room: Room = {
              code,
              players: [],
              gameState: null,
              gameLoop: null,
              spawnTimer: null,
              gameMode: 'casual',
              isQuickPlay: false,
              hostReady: false,
              guestReady: false,
              roundPaused: false,
              abilityTimers: []
            };
            
            const player: Player = { ws, id: 1, keys: { up: false, down: false, left: false, right: false }, roomCode: code };
            room.players.push(player);
            rooms.set(code, room);
            
            currentRoom = room;
            currentPlayer = player;
            
            sendToPlayer(player, { type: 'room_created', code, playerId: 1 });
            log(`Room ${code} created`, 'ws');
            break;
          }

          case 'join_room': {
            const code = message.code?.toUpperCase();
            const room = rooms.get(code);
            
            if (!room) {
              ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
              break;
            }
            
            if (room.players.length >= 2) {
              ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
              break;
            }
            
            const player: Player = { ws, id: 2, keys: { up: false, down: false, left: false, right: false }, roomCode: code };
            room.players.push(player);
            
            currentRoom = room;
            currentPlayer = player;
            
            sendToPlayer(player, { type: 'room_joined', code, playerId: 2 });
            
            const p1 = room.players.find(p => p.id === 1);
            if (p1) {
              sendToPlayer(p1, { type: 'opponent_joined' });
            }
            
            log(`Player joined room ${code}`, 'ws');
            break;
          }

          case 'quick_play': {
            const player: Player = { ws, id: 1, keys: { up: false, down: false, left: false, right: false } };
            currentPlayer = player;
            
            // Remove any disconnected players from queue first
            for (let i = quickPlayQueue.length - 1; i >= 0; i--) {
              if (quickPlayQueue[i].ws.readyState !== WebSocket.OPEN) {
                quickPlayQueue.splice(i, 1);
              }
            }
            
            if (quickPlayQueue.length > 0) {
              const opponent = quickPlayQueue.shift()!;
              
              // Verify opponent is still connected
              if (opponent.ws.readyState !== WebSocket.OPEN) {
                // Opponent disconnected, add self to queue
                quickPlayQueue.push(player);
                sendToPlayer(player, { type: 'quick_searching' });
                log('Opponent disconnected, player added to Quick Play queue', 'ws');
                break;
              }
              
              const code = generateRoomCode();
              const room: Room = {
                code,
                players: [],
                gameState: null,
                gameLoop: null,
                spawnTimer: null,
                gameMode: 'competitive',
                isQuickPlay: true,
                hostReady: false,
                guestReady: false,
                roundPaused: false,
                abilityTimers: []
              };
              
              opponent.id = 1;
              player.id = 2;
              opponent.roomCode = code;
              player.roomCode = code;
              room.players.push(opponent, player);
              rooms.set(code, room);
              
              currentRoom = room;
              
              sendToPlayer(opponent, { type: 'quick_matched', code, playerId: 1 });
              sendToPlayer(player, { type: 'quick_matched', code, playerId: 2 });
              
              log(`Quick Play match created: ${code}`, 'ws');
            } else {
              quickPlayQueue.push(player);
              sendToPlayer(player, { type: 'quick_searching' });
              log('Player added to Quick Play queue', 'ws');
            }
            break;
          }

          case 'cancel_quick_play': {
            const idx = quickPlayQueue.findIndex(p => p.ws === ws);
            if (idx !== -1) {
              quickPlayQueue.splice(idx, 1);
              log('Player left Quick Play queue', 'ws');
            }
            break;
          }

          case 'select_mode': {
            const room = currentRoom || (currentPlayer?.roomCode ? rooms.get(currentPlayer.roomCode) : null);
            if (!room || room.isQuickPlay) break;
            room.gameMode = message.mode;
            // Clear ability selections when switching to competitive mode
            if (message.mode === 'competitive') {
              room.players.forEach(p => { p.selectedAbility = undefined; });
            }
            broadcast(room, { type: 'mode_selected', mode: message.mode });
            break;
          }

          case 'select_ability': {
            const room = currentRoom || (currentPlayer?.roomCode ? rooms.get(currentPlayer.roomCode) : null);
            if (!room || !currentPlayer) break;
            currentPlayer.selectedAbility = message.ability;
            
            const otherPlayer = room.players.find(p => p.id !== currentPlayer!.id);
            if (otherPlayer) {
              sendToPlayer(otherPlayer, { type: 'opponent_ability_selected' });
            }
            
            if (room.players.every(p => p.selectedAbility)) {
              broadcast(room, { type: 'abilities_ready' });
            }
            break;
          }

          case 'start_game': {
            const room = currentRoom || (currentPlayer?.roomCode ? rooms.get(currentPlayer.roomCode) : null);
            if (!room || room.players.length !== 2) break;
            
            room.gameState = createInitialGameState(room.gameMode);
            
            if (room.gameMode === 'competitive') {
              const p1 = room.players.find(p => p.id === 1);
              const p2 = room.players.find(p => p.id === 2);
              if (p1) room.gameState.p1.selectedAbility = p1.selectedAbility;
              if (p2) room.gameState.p2.selectedAbility = p2.selectedAbility;
            }
            
            broadcast(room, { 
              type: 'game_started', 
              state: room.gameState,
              mode: room.gameMode
            });
            
            room.roundPaused = true;
            setTimeout(() => {
              room.roundPaused = false;
            }, 1500);
            
            room.gameLoop = setInterval(() => {
              if (room && room.gameState && room.gameState.gameActive && !room.roundPaused) {
                updateGameState(room);
                broadcast(room, { type: 'state_update', state: room.gameState });
              }
            }, 1000 / 60);
            
            if (room.gameMode === 'casual') {
              startSpawnTimer(room);
            }
            
            log(`Game started in room ${room.code} (${room.gameMode})`, 'ws');
            break;
          }

          case 'input': {
            const room = currentRoom || (currentPlayer?.roomCode ? rooms.get(currentPlayer.roomCode) : null);
            if (!room || !currentPlayer || !room.gameState) break;
            currentPlayer.keys = message.keys || { up: false, down: false, left: false, right: false };
            break;
          }

          case 'dash': {
            const room = currentRoom || (currentPlayer?.roomCode ? rooms.get(currentPlayer.roomCode) : null);
            if (!room || !currentPlayer || !room.gameState) break;
            handleDash(room, currentPlayer);
            break;
          }

          case 'ability': {
            const room = currentRoom || (currentPlayer?.roomCode ? rooms.get(currentPlayer.roomCode) : null);
            if (!room || !currentPlayer || !room.gameState) break;
            if (room.gameMode !== 'competitive') break;
            handleAbility(room, currentPlayer);
            break;
          }

          case 'leave_room': {
            handleDisconnect();
            break;
          }
        }
      } catch (err) {
        log(`WebSocket error: ${err}`, 'ws');
      }
    });

    ws.on('close', () => {
      handleDisconnect();
    });

    function handleDisconnect() {
      const queueIdx = quickPlayQueue.findIndex(p => p.ws === ws);
      if (queueIdx !== -1) {
        quickPlayQueue.splice(queueIdx, 1);
      }
      
      const room = currentRoom || (currentPlayer?.roomCode ? rooms.get(currentPlayer.roomCode) : null);
      if (room) {
        if (room.gameLoop) clearInterval(room.gameLoop);
        if (room.spawnTimer) clearTimeout(room.spawnTimer);
        
        room.players.forEach(p => {
          if (p !== currentPlayer) {
            sendToPlayer(p, { type: 'opponent_left' });
          }
        });
        
        rooms.delete(room.code);
        log(`Room ${room.code} closed`, 'ws');
        
        currentRoom = null;
        currentPlayer = null;
      }
    }
  });

  log('WebSocket server initialized', 'ws');
}

function startSpawnTimer(room: Room) {
  if (room.spawnTimer) clearTimeout(room.spawnTimer);
  
  const spawnDelay = 5000 + Math.random() * 15000;
  room.spawnTimer = setTimeout(() => {
    if (room.gameState && room.gameState.gameActive && room.gameState.powerUps.length < 3) {
      spawnPowerUp(room);
    }
    startSpawnTimer(room);
  }, spawnDelay);
}

function spawnPowerUp(room: Room) {
  const types = Object.keys(POWERUP_TYPES);
  const type = types[Math.floor(Math.random() * types.length)];
  
  const powerUp: PowerUpState = {
    id: ++powerUpIdCounter,
    x: 100 + Math.random() * (CANVAS_WIDTH - 200),
    y: 100 + Math.random() * (CANVAS_HEIGHT - 200),
    type,
    color: POWERUP_TYPES[type].color,
    pulse: 0
  };
  
  room.gameState!.powerUps.push(powerUp);
  broadcast(room, { type: 'powerup_spawned', powerUp });
}

function updateGameState(room: Room) {
  const state = room.gameState!;
  if (state.isPaused || !state.gameActive) return;

  state.powerUps.forEach(p => { p.pulse += 0.1; });

  for (let i = state.mirages.length - 1; i >= 0; i--) {
    const m = state.mirages[i];
    m.x += m.vx;
    m.y += m.vy;
    
    if (m.x < 0 || m.x > CANVAS_WIDTH) m.vx *= -1;
    if (m.y < 0 || m.y > CANVAS_HEIGHT) m.vy *= -1;
    
    m.life -= 1/60;
    
    const opponent = m.owner === 1 ? state.p2 : state.p1;
    const dist = Math.sqrt((opponent.x - m.x)**2 + (opponent.y - m.y)**2);
    
    // Track if this mirage already hit this update cycle to prevent spam
    if (!m.hitCooldown) m.hitCooldown = 0;
    if (m.hitCooldown > 0) m.hitCooldown--;
    
    if (dist < 20 + opponent.radius && !opponent.isBlocking && m.hitCooldown <= 0) {
      const angle = Math.atan2(opponent.y - m.y, opponent.x - m.x);
      if (!opponent.isGrid) {
        opponent.vx += Math.cos(angle) * 15;
        opponent.vy += Math.sin(angle) * 15;
      }
      // Don't remove mirage on contact - just add cooldown to prevent spam hits
      m.hitCooldown = 30; // Half second cooldown before it can hit again
    }
    
    // Only remove when timer expires
    if (m.life <= 0) {
      state.mirages.splice(i, 1);
    }
  }

  for (let i = state.voidWells.length - 1; i >= 0; i--) {
    const v = state.voidWells[i];
    v.life -= 1/60;
    
    const opponent = v.owner === 1 ? state.p2 : state.p1;
    const dx = v.x - opponent.x;
    const dy = v.y - opponent.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    
    if (dist < 800 && !opponent.isBlocking && !opponent.isGrid) {
      const force = (1 - dist/800) * 2.5;
      const angle = Math.atan2(dy, dx);
      opponent.vx += Math.cos(angle) * force;
      opponent.vy += Math.sin(angle) * force;
      
      if (dist < 50 && !opponent.isStunned) {
        opponent.isStunned = true;
        trackTimer(room, () => { opponent.isStunned = false; }, v.life * 1000);
        // Deplete ability cooldown by 5 seconds (300 ticks = half of 10sec cooldown)
        if (state.gameMode === 'competitive') {
          opponent.abilityCooldown = Math.min(COMP_COOLDOWN, opponent.abilityCooldown + 300);
        }
      }
    }
    
    if (v.life <= 0) {
      state.voidWells.splice(i, 1);
    }
  }

  // Infinity field physics - inescapable slowing/repelling field
  const INFINITY_RADIUS = 150;
  [{ owner: state.p1, target: state.p2 }, { owner: state.p2, target: state.p1 }].forEach(({ owner, target }) => {
    if (!owner.isInfinityActive) return;
    
    const dx = owner.x - target.x;
    const dy = owner.y - target.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const MIN_DISTANCE = owner.radius + target.radius + 20; // Truly untouchable
    
    // Field affects target - but dashing allows escape
    if (dist < INFINITY_RADIUS) {
      // Proximity factor: 0 at edge, 1 at center
      const proximityFactor = 1 - (dist / INFINITY_RADIUS);
      
      // Dashing allows escape - skip slowdown/drag but still prevent touching
      if (!target.isDashing) {
        // Extreme slowing at center (0.05x), normal at edge (1.0x)
        // Quadratic falloff for more dramatic effect near center
        const slowFactor = 0.05 + (1 - proximityFactor * proximityFactor) * 0.95;
        
        // Apply slowing to target's velocity
        if (!target.isGrid && !target.isEchoFrozen) {
          target.vx *= slowFactor;
          target.vy *= slowFactor;
        }
        
        // Drag target with field when owner moves
        // Stronger drag when closer (quadratic for much stronger at center)
        if (!target.isGrid && !target.isEchoFrozen) {
          const dragStrength = proximityFactor * proximityFactor * 1.2;
          target.vx += owner.vx * dragStrength * 0.5;
          target.vy += owner.vy * dragStrength * 0.5;
          
          // Also add resistance to escaping - pull back towards center slightly
          if (dist > 0) {
            const pullStrength = proximityFactor * 0.3;
            target.vx += (dx / dist) * pullStrength;
            target.vy += (dy / dist) * pullStrength;
          }
        }
      }
      
      // When owner is dashing, apply direction-based drag (gradient)
      // Only if target is NOT dashing (dash escape still works)
      if (owner.isDashing && !target.isDashing && !target.isGrid && !target.isEchoFrozen && dist > 0) {
        // Calculate dot product between dash direction and direction to target
        const dashSpeed = Math.sqrt(owner.vx * owner.vx + owner.vy * owner.vy);
        if (dashSpeed > 0) {
          const dashDirX = owner.vx / dashSpeed;
          const dashDirY = owner.vy / dashSpeed;
          const toTargetX = (target.x - owner.x) / dist;
          const toTargetY = (target.y - owner.y) / dist;
          const dotProduct = dashDirX * toTargetX + dashDirY * toTargetY;
          
          // Directional gradient: 0 at dot=0 (perpendicular), 1 at dot=1 (direct)
          const directionFactor = Math.max(0, dotProduct);
          
          if (directionFactor > 0) {
            const clampedProximity = Math.max(0, Math.min(1, proximityFactor));
            const relVx = target.vx - owner.vx;
            const relVy = target.vy - owner.vy;
            
            // Strength scaled by proximity AND direction factor
            const strength = clampedProximity * directionFactor;
            const dampFactor = 0.95 * strength;
            target.vx -= relVx * dampFactor;
            target.vy -= relVy * dampFactor;
            
            const dragStrength = strength * 0.85;
            target.vx += owner.vx * dragStrength;
            target.vy += owner.vy * dragStrength;
          }
        }
      }
      
      // Strong repulsion to prevent touching - even dashing can't touch the player
      if (dist < MIN_DISTANCE && dist > 0 && !target.isGrid) {
        const angle = Math.atan2(-dy, -dx);
        const pushForce = (MIN_DISTANCE - dist) * 1.5; // Much stronger push
        target.x += Math.cos(angle) * pushForce;
        target.y += Math.sin(angle) * pushForce;
        // Also cancel velocity towards owner
        const velTowardsOwner = (target.vx * dx + target.vy * dy) / dist;
        if (velTowardsOwner > 0) {
          target.vx -= (dx / dist) * velTowardsOwner;
          target.vy -= (dy / dist) * velTowardsOwner;
        }
      }
    }
  });

  [{ player: room.players.find(p => p.id === 1), pState: state.p1 },
   { player: room.players.find(p => p.id === 2), pState: state.p2 }].forEach(({ player, pState }) => {
    if (!player) return;
    const opponent = pState === state.p1 ? state.p2 : state.p1;

    if (state.gameMode === 'competitive' && pState.abilityCooldown > 0) {
      pState.abilityCooldown--;
    }

    if (!pState.isBlocking && !pState.isStunned && !pState.isMeteor && !pState.isEchoFrozen) {
      let moveX = 0, moveY = 0;
      
      // Infinity owner is slightly slower
      const infinitySlowMult = pState.isInfinityActive ? 0.9 : 1.0;

      if (pState.isGrid) {
        const gridSpeed = 9.5 * infinitySlowMult;
        if (player.keys.up) pState.gridDirection = { dx: 0, dy: -1 };
        else if (player.keys.down) pState.gridDirection = { dx: 0, dy: 1 };
        else if (player.keys.left) pState.gridDirection = { dx: -1, dy: 0 };
        else if (player.keys.right) pState.gridDirection = { dx: 1, dy: 0 };
        
        if (!pState.isDashing) {
          pState.vx = pState.gridDirection.dx * gridSpeed;
          pState.vy = pState.gridDirection.dy * gridSpeed;
        }
      } else {
        if (player.keys.up) moveY -= 1;
        if (player.keys.down) moveY += 1;
        if (player.keys.left) moveX -= 1;
        if (player.keys.right) moveX += 1;
        
        if (moveX !== 0 || moveY !== 0) {
          const length = Math.sqrt(moveX ** 2 + moveY ** 2);
          const accel = 0.85 * pState.speedMult * (pState.isFrozen ? 0.3 : 1) * infinitySlowMult;
          pState.vx += (moveX / length) * accel;
          pState.vy += (moveY / length) * accel;
        }
      }
    }

    if (pState.isEchoFrozen) {
      pState.vx = 0;
      pState.vy = 0;
    }

    if (!pState.isGrid && !pState.isEchoFrozen) {
      pState.vx *= 0.94;
      pState.vy *= 0.94;
    }

    pState.x += pState.vx;
    pState.y += pState.vy;

    if (pState.hasShield) {
      if (pState.x < pState.radius) { pState.x = pState.radius; pState.vx *= -1; }
      if (pState.x > CANVAS_WIDTH - pState.radius) { pState.x = CANVAS_WIDTH - pState.radius; pState.vx *= -1; }
      if (pState.y < pState.radius) { pState.y = pState.radius; pState.vy *= -1; }
      if (pState.y > CANVAS_HEIGHT - pState.radius) { pState.y = CANVAS_HEIGHT - pState.radius; pState.vy *= -1; }
    }

    for (let i = state.powerUps.length - 1; i >= 0; i--) {
      const pu = state.powerUps[i];
      const dist = Math.sqrt((pState.x - pu.x)**2 + (pState.y - pu.y)**2);
      if (dist < pState.radius + 15) {
        applyPowerUp(room, pState, opponent, pu.type);
        state.powerUps.splice(i, 1);
        broadcast(room, { type: 'powerup_collected', id: pu.id, player: pState.name });
      }
    }

    if (pState.x < 0 || pState.x > CANVAS_WIDTH || pState.y < 0 || pState.y > CANVAS_HEIGHT) {
      const winner = pState === state.p1 ? state.p2 : state.p1;
      winner.score++;
      state.flash = 1.0;
      
      if (winner.score >= MAX_SCORE) {
        state.gameActive = false;
        state.winner = winner.name;
        // Clear abilities for potential rematch
        room.players.forEach(p => { p.selectedAbility = undefined; });
        broadcast(room, { type: 'game_over', winner: winner.name, state });
      } else {
        resetRound(room);
        broadcast(room, { type: 'round_over', winner: winner.name, state });
        room.roundPaused = true;
        setTimeout(() => {
          broadcast(room, { type: 'round_ready' });
          setTimeout(() => {
            room.roundPaused = false;
            broadcast(room, { type: 'round_go' });
          }, 1500);
        }, 1000);
      }
    }
  });

  const dist = Math.sqrt((state.p2.x - state.p1.x) ** 2 + (state.p2.y - state.p1.y) ** 2);
  if (dist < state.p1.radius + state.p2.radius) {
    const angle = Math.atan2(state.p2.y - state.p1.y, state.p2.x - state.p1.x);
    const dashImpact = 28;
    const bumpForce = 8;
    const midX = (state.p1.x + state.p2.x) / 2;
    const midY = (state.p1.y + state.p2.y) / 2;

    // Separate overlapping players
    const overlap = (state.p1.radius + state.p2.radius) - dist;
    if (overlap > 0) {
      const separateX = Math.cos(angle) * (overlap / 2 + 1);
      const separateY = Math.sin(angle) * (overlap / 2 + 1);
      if (!state.p1.isEchoFrozen && !state.p1.isGrid) { state.p1.x -= separateX; state.p1.y -= separateY; }
      if (!state.p2.isEchoFrozen && !state.p2.isGrid) { state.p2.x += separateX; state.p2.y += separateY; }
      // If one is frozen, push the other fully
      if (state.p2.isEchoFrozen && !state.p1.isGrid) { state.p1.x -= separateX * 2; state.p1.y -= separateY * 2; }
      if (state.p1.isEchoFrozen && !state.p2.isGrid) { state.p2.x += separateX * 2; state.p2.y += separateY * 2; }
    }

    const p1Dashing = state.p1.isDashing || state.p1.speedMult > 1;
    const p2Dashing = state.p2.isDashing || state.p2.speedMult > 1;
    
    // Vessel multipliers for knockback
    const p1VesselMult = state.p1.isVesselActive ? 2.0 : 1.0;
    const p2VesselMult = state.p2.isVesselActive ? 2.0 : 1.0;

    let collisionIntensity = 5;
    if (p1Dashing && state.p2.isBlocking) {
      applyImpact(state.p1, angle + Math.PI, dashImpact * 2.0);
      applyImpact(state.p2, angle, 2 * p1VesselMult);
      triggerRecoil(state.p1);
      state.shake = 20 * (state.p1.isVesselActive ? 1.5 : 1);
      collisionIntensity = 20;
    } else if (p2Dashing && state.p1.isBlocking) {
      applyImpact(state.p2, angle, dashImpact * 2.0);
      applyImpact(state.p1, angle + Math.PI, 2 * p2VesselMult);
      triggerRecoil(state.p2);
      state.shake = 20 * (state.p2.isVesselActive ? 1.5 : 1);
      collisionIntensity = 20;
    } else if (p1Dashing && p2Dashing) {
      applyImpact(state.p1, angle + Math.PI, dashImpact * p2VesselMult);
      applyImpact(state.p2, angle, dashImpact * p1VesselMult);
      if (!state.p1.isEchoFrozen) triggerRecoil(state.p1);
      if (!state.p2.isEchoFrozen) triggerRecoil(state.p2);
      state.shake = 25;
      collisionIntensity = 25;
    } else if (p1Dashing) {
      applyImpact(state.p2, angle, dashImpact * p1VesselMult);
      if (state.p2.isEchoFrozen) {
        state.p1.vx *= 0.05;
        state.p1.vy *= 0.05;
        state.p1.vx -= Math.cos(angle) * 3;
        state.p1.vy -= Math.sin(angle) * 3;
      } else if (!state.p1.isGrid) {
        state.p1.vx *= 0.8;
        state.p1.vy *= 0.8;
      }
      if (!state.p2.isEchoFrozen) triggerRecoil(state.p2);
      state.shake = 15 * (state.p1.isVesselActive ? 1.5 : 1);
      collisionIntensity = 15 * (state.p1.isVesselActive ? 1.5 : 1);
      if (state.gameMode === 'competitive') {
        state.p2.abilityCooldown = Math.min(COMP_COOLDOWN, state.p2.abilityCooldown + 200);
      }
    } else if (p2Dashing) {
      applyImpact(state.p1, angle + Math.PI, dashImpact * p2VesselMult);
      if (state.p1.isEchoFrozen) {
        state.p2.vx *= 0.05;
        state.p2.vy *= 0.05;
        state.p2.vx += Math.cos(angle) * 3;
        state.p2.vy += Math.sin(angle) * 3;
      } else if (!state.p2.isGrid) {
        state.p2.vx *= 0.8;
        state.p2.vy *= 0.8;
      }
      if (!state.p1.isEchoFrozen) triggerRecoil(state.p1);
      state.shake = 15 * (state.p2.isVesselActive ? 1.5 : 1);
      collisionIntensity = 15 * (state.p2.isVesselActive ? 1.5 : 1);
      if (state.gameMode === 'competitive') {
        state.p1.abilityCooldown = Math.min(COMP_COOLDOWN, state.p1.abilityCooldown + 200);
      }
    } else {
      // Bump collision - vessel causes opponent to receive delayed ghost hit (like Echo)
      const p1HasVessel = state.p1.isVesselActive;
      const p2HasVessel = state.p2.isVesselActive;
      const vesselShakeMult = (p1HasVessel || p2HasVessel) ? 1.5 : 1.0;
      // Calculate mass-scaled bump forces
      const f1 = bumpForce * (state.p2.mass / state.p1.mass);
      const f2 = bumpForce * (state.p1.mass / state.p2.mass);
      
      if (p1HasVessel || p2HasVessel) {
        // VESSEL player gets normal bump, opponent gets two FULL bumps
        if (p1HasVessel) {
          applyImpact(state.p1, angle + Math.PI, f1);
          applyImpact(state.p2, angle, f2);
          const savedAngle = angle;
          const savedF2 = f2;
          trackTimer(room, () => {
            applyImpact(state.p2, savedAngle, savedF2);
            state.shake = Math.max(state.shake, 5);
            broadcast(room, { type: 'collision_effect', x: state.p2.x, y: state.p2.y, intensity: 5 });
          }, 300);
        } else {
          applyImpact(state.p2, angle, f2);
          applyImpact(state.p1, angle + Math.PI, f1);
          const savedAngle = angle;
          const savedF1 = f1;
          trackTimer(room, () => {
            applyImpact(state.p1, savedAngle + Math.PI, savedF1);
            state.shake = Math.max(state.shake, 5);
            broadcast(room, { type: 'collision_effect', x: state.p1.x, y: state.p1.y, intensity: 5 });
          }, 300);
        }
      } else {
        // Normal bump - no vessel
        applyImpact(state.p1, angle + Math.PI, f1);
        applyImpact(state.p2, angle, f2);
      }
      
      state.shake = 5 * vesselShakeMult;
      collisionIntensity = 5 * vesselShakeMult;
    }
    
    // Broadcast collision effect only on first collision detection
    if (!state.playersColliding) {
      state.playersColliding = true;
      broadcast(room, { type: 'collision_effect', x: midX, y: midY, intensity: collisionIntensity });
    }
  } else {
    // Players no longer colliding
    state.playersColliding = false;
  }

  if (state.shake > 0) state.shake *= 0.9;
  if (state.flash > 0) state.flash -= 0.04;
}

function trackTimer(room: Room, callback: () => void, delay: number): NodeJS.Timeout {
  const timer = setTimeout(() => {
    callback();
    const idx = room.abilityTimers.indexOf(timer);
    if (idx !== -1) room.abilityTimers.splice(idx, 1);
  }, delay);
  room.abilityTimers.push(timer);
  return timer;
}

function applyPowerUp(room: Room, player: PlayerState, opponent: PlayerState, type: string) {
  const state = room.gameState!;
  const playerId: 1 | 2 = player === state.p1 ? 1 : 2;
  
  switch (type) {
    case 'SPEED':
      player.speedMult = 1.8;
      trackTimer(room, () => { player.speedMult = 1; }, 5000);
      break;
      
    case 'SIZE':
      player.radius = 45;
      player.mass = 3;
      trackTimer(room, () => { player.radius = 20; player.mass = 1; }, 7000);
      break;
      
    case 'SHIELD':
      player.hasShield = true;
      trackTimer(room, () => { player.hasShield = false; }, 8000);
      break;
      
    case 'FREEZE':
      opponent.isFrozen = true;
      trackTimer(room, () => { opponent.isFrozen = false; }, 4500);
      break;
      
    case 'WAVE':
      const dx = opponent.x - player.x;
      const dy = opponent.y - player.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < 450 && !opponent.isBlocking && !opponent.isGrid) {
        const angle = Math.atan2(dy, dx);
        const force = (1 - dist / 450) * 45;
        opponent.vx += Math.cos(angle) * force;
        opponent.vy += Math.sin(angle) * force;
        state.shake = 15;
      }
      // Broadcast wave effect event (always emit wave visual)
      broadcast(room, { type: 'wave_effect', x: player.x, y: player.y, playerId });
      break;
      
    case 'VOID':
      state.voidWells.push({
        id: ++voidWellIdCounter,
        x: player.x,
        y: player.y,
        life: 3,
        owner: playerId
      });
      break;
      
    case 'MIRROR':
      for (let i = 0; i < 4; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 12 + Math.random() * 6;
        state.mirages.push({
          id: ++mirageIdCounter,
          owner: playerId,
          x: player.x,
          y: player.y,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd,
          life: 5
        });
      }
      break;
      
    case 'METEOR':
      player.isMeteor = true;
      const targetX = opponent.x;
      const targetY = opponent.y;
      trackTimer(room, () => {
        player.x = targetX;
        player.y = targetY;
        player.isMeteor = false;
        state.shake = 40;
        
        const dx = opponent.x - player.x;
        const dy = opponent.y - player.y;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d < 150 && !opponent.isBlocking && !opponent.isGrid) {
          const angle = Math.atan2(dy, dx);
          opponent.vx += Math.cos(angle) * 50;
          opponent.vy += Math.sin(angle) * 50;
        }
      }, 800);
      break;
      
    case 'GRID':
      player.isGrid = true;
      player.vx = 0;
      player.vy = 0;
      player.gridDirection = { dx: playerId === 1 ? 1 : -1, dy: 0 };
      trackTimer(room, () => { player.isGrid = false; }, 6000);
      break;
      
    case 'ECHO':
      player.vx = 0;
      player.vy = 0;
      player.isEchoActive = true;
      player.isStunned = true;
      
      const echoDx = opponent.x - player.x;
      const echoDy = opponent.y - player.y;
      const echoDist = Math.sqrt(echoDx*echoDx + echoDy*echoDy);
      
      // Can't echo someone through their Infinity field
      if (echoDist < 150 && !opponent.isBlocking && !opponent.isGrid && !opponent.isInfinityActive) {
        const targetDist = player.radius + opponent.radius + 5;
        
        const pullSteps = 30;
        let step = 0;
        let echoContactMade = false;
        const pullInterval = setInterval(() => {
          // Check if opponent activated Infinity during pull - abort if so
          if (opponent.isInfinityActive) {
            clearInterval(pullInterval);
            player.isEchoActive = false;
            player.isStunned = false;
            return;
          }
          
          const d = Math.sqrt((player.x - opponent.x)**2 + (player.y - opponent.y)**2);
          if (d > targetDist && step < pullSteps) {
            const stepSize = (d - targetDist) / (pullSteps - step);
            const a = Math.atan2(player.y - opponent.y, player.x - opponent.x);
            opponent.x += Math.cos(a) * stepSize;
            opponent.y += Math.sin(a) * stepSize;
            step++;
            
            // Mark contact when close enough
            if (d < targetDist + 5) {
              echoContactMade = true;
            }
          } else {
            clearInterval(pullInterval);
            player.isEchoActive = false;
            player.isStunned = false;
            
            // Only freeze if actual contact was made
            if (echoContactMade && !opponent.isEchoFrozen && !opponent.isInfinityActive) {
              opponent.isEchoFrozen = true;
              opponent.echoHistory = [];
              setTimeout(() => {
                opponent.isEchoFrozen = false;
                const startTime = opponent.echoHistory.length > 0 ? opponent.echoHistory[0].time : 0;
                opponent.echoHistory.forEach(h => {
                  const replayDelay = Math.min(1000, (h.time - startTime) / 3);
                  setTimeout(() => {
                    if (!opponent.isGrid) {
                      opponent.vx += Math.cos(h.angle) * h.force;
                      opponent.vy += Math.sin(h.angle) * h.force;
                    }
                  }, replayDelay);
                });
                opponent.echoHistory = [];
              }, 3000);
            }
          }
        }, 16);
      } else {
        trackTimer(room, () => { player.isEchoActive = false; player.isStunned = false; }, 400);
      }
      break;
      
    case 'BLITZ':
      // Capture current velocity at activation and double it for dash power
      const blitzCurrentSpeed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
      // Use 2x current speed, with minimum of 20 if player is nearly stationary
      const blitzDashPower = Math.max(20, blitzCurrentSpeed * 2);
      let blitzDashCount = 0;
      
      const performBlitzDash = () => {
        if (blitzDashCount >= 3) return;
        
        // Get current direction from keys
        let bdx = 0, bdy = 0;
        const blitzPlayer = room.players.find(p => (p.id === 1 ? state.p1 : state.p2) === player);
        if (blitzPlayer) {
          if (blitzPlayer.keys.up) bdy -= 1;
          if (blitzPlayer.keys.down) bdy += 1;
          if (blitzPlayer.keys.left) bdx -= 1;
          if (blitzPlayer.keys.right) bdx += 1;
        }
        
        // If no direction, use current velocity direction or face opponent
        if (bdx === 0 && bdy === 0) {
          if (Math.abs(player.vx) > 0.5 || Math.abs(player.vy) > 0.5) {
            const len = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
            bdx = player.vx / len; bdy = player.vy / len;
          } else {
            bdx = (opponent.x > player.x) ? 1 : -1;
          }
        } else {
          const len = Math.sqrt(bdx * bdx + bdy * bdy);
          bdx /= len; bdy /= len;
        }
        
        // Apply dash
        player.vx = bdx * blitzDashPower;
        player.vy = bdy * blitzDashPower;
        player.isDashing = true;
        
        blitzDashCount++;
        
        if (blitzDashCount < 3) {
          // End dash after 150ms, freeze briefly, then allow next dash
          setTimeout(() => {
            player.isDashing = false;
            player.vx *= 0.1; player.vy *= 0.1;
            player.isStunned = true;
            
            // Brief freeze between dashes
            setTimeout(() => {
              player.isStunned = false;
              performBlitzDash();
            }, 120);
          }, 150);
        } else {
          // Final dash ends normally
          setTimeout(() => {
            player.isDashing = false;
          }, 150);
        }
      };
      
      performBlitzDash();
      break;
      
    case 'INFINITY':
      // Infinity ability - creates a slowing/repelling field around the player
      player.isInfinityActive = true;
      trackTimer(room, () => { player.isInfinityActive = false; }, 6000);
      break;
      
    case 'VESSEL':
      // Vessel ability - doubles bump and dash knockback for a short time
      player.isVesselActive = true;
      trackTimer(room, () => { player.isVesselActive = false; }, 5000);
      break;
  }
}

function applyImpact(player: PlayerState, angle: number, force: number) {
  if (player.isGrid) return;
  if (player.isEchoFrozen) {
    player.echoHistory.push({ angle, force, time: Date.now() });
    return;
  }
  const massMultiplier = 1 / player.mass;
  player.vx += Math.cos(angle) * force * massMultiplier;
  player.vy += Math.sin(angle) * force * massMultiplier;
}

function triggerRecoil(player: PlayerState) {
  player.recoil = true;
  player.isBlocking = false;
  player.isDashing = false;
  setTimeout(() => { player.recoil = false; }, 500);
}

function resetRound(room: Room) {
  const state = room.gameState!;
  // Clear all ability timers to prevent effects from bleeding into new round
  room.abilityTimers.forEach(t => clearTimeout(t));
  room.abilityTimers = [];
  
  state.p1.x = 250; state.p1.y = 325; state.p1.vx = 0; state.p1.vy = 0;
  state.p2.x = 750; state.p2.y = 325; state.p2.vx = 0; state.p2.vy = 0;
  resetPlayerState(state.p1);
  resetPlayerState(state.p2);
  state.powerUps = [];
  state.mirages = [];
  state.voidWells = [];
}

function resetPlayerState(player: PlayerState) {
  player.dashReady = true;
  player.isDashing = false;
  player.isBlocking = false;
  player.recoil = false;
  player.radius = 20;
  player.mass = 1;
  player.speedMult = 1;
  player.hasShield = false;
  player.isFrozen = false;
  player.isStunned = false;
  player.isMeteor = false;
  player.isGrid = false;
  player.isEchoActive = false;
  player.isEchoFrozen = false;
  player.isInfinityActive = false;
  player.isVesselActive = false;
  player.echoHistory = [];
  player.gridDirection = { dx: 0, dy: 0 };
  player.abilityCooldown = 0;
}

function handleDash(room: Room, player: Player) {
  const state = room.gameState!;
  const pState = player.id === 1 ? state.p1 : state.p2;
  
  // Block dash during countdown
  if (room.roundPaused) return;
  
  if (!pState.dashReady || pState.recoil || pState.isFrozen || pState.isStunned || pState.isMeteor || pState.isEchoFrozen) return;

  let dx = 0, dy = 0;
  
  if (pState.isGrid) {
    dx = pState.gridDirection.dx;
    dy = pState.gridDirection.dy;
    const dashPower = 23;
    pState.vx = dx * dashPower;
    pState.vy = dy * dashPower;
    pState.isDashing = true;
    pState.isGrid = false;
    setTimeout(() => { pState.isDashing = false; }, 350);
  } else {
    if (player.keys.up) dy -= 1;
    if (player.keys.down) dy += 1;
    if (player.keys.left) dx -= 1;
    if (player.keys.right) dx += 1;
    
    if (dx === 0 && dy === 0) {
      pState.vx = 0;
      pState.vy = 0;
      pState.isBlocking = true;
      state.shake = 2;
      setTimeout(() => { pState.isBlocking = false; }, 400);
    } else {
      const dashPower = 23;
      const angle = Math.atan2(dy, dx);
      pState.vx = Math.cos(angle) * dashPower;
      pState.vy = Math.sin(angle) * dashPower;
      pState.isDashing = true;
      setTimeout(() => { pState.isDashing = false; }, 350);
    }
  }
  
  pState.dashReady = false;
  setTimeout(() => { pState.dashReady = true; }, 1600);
}

function handleAbility(room: Room, player: Player) {
  const state = room.gameState!;
  const pState = player.id === 1 ? state.p1 : state.p2;
  const opponent = player.id === 1 ? state.p2 : state.p1;
  
  // Block ability use during countdown
  if (room.roundPaused) return;
  
  if (pState.abilityCooldown > 0 || !pState.selectedAbility) return;
  
  applyPowerUp(room, pState, opponent, pState.selectedAbility);
  pState.abilityCooldown = COMP_COOLDOWN;
}
