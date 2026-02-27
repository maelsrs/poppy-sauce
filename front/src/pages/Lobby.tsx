import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Field } from '../components/ui';
import { request } from '../services/auth';

// --- Types ---
type CategoryMode = 'uniquement' | 'enlever';

type Category = {
  id: string;
  name: string;
  mode: CategoryMode;
};

type Player = {
  player_uuid: string;
  pseudo: string | null;
  is_owner: boolean;
  is_connected: boolean;
  points: number;
};

type CurrentQuestion = {
  question: string;
  question_type: string;
  image_url: string | null;
  time_limit: number;
  round: number;
  question_index: number;
  total_questions: number;
};


type ChatMessage = {
  player_uuid: string;
  pseudo: string;
  text: string;
  timestamp: number;
};

type LeaderboardEntry = {
  player_uuid: string;
  pseudo: string;
  points: number;
  rounds_won: number;
  rank: number;
};

const sampleCategories: Category[] = [];

const CATEGORY_POOL = [
  'Culture pop',
  'Histoire',
  'Sciences',
  'Géographie',
  'Cinéma',
  'Technologie',
  'Sport',
  'Musique',
  'Littérature',
  'Cuisine',
  'Animaux',
  'Art',
  'Jeux vidéo',
  'Nature',
  'Mythologie',
  'Voyages',
];

// --- Icons ---
const IconGear = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);

const IconChevronLeft = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="m15 18-6-6 6-6" />
  </svg>
);

type UserProfile = {
  username: string;
  level: number;
  playtime: number;
};

const formatPlaytime = (seconds: number): string => {
  if (seconds < 60) return '< 1min';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
};

const clampInput = (value: string, min: number, max: number, fallback: number) => {
  if (value.trim() === '') return fallback;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

function LobbyPage() {
  const navigate = useNavigate();
  const params = useParams();
  const roomCode = (params.code ?? '').toUpperCase();
  const { user, loading: authLoading } = useAuth();
  const [configOpen, setConfigOpen] = useState(true);
  const [targetScore, setTargetScore] = useState(100);
  const [targetScoreDraft, setTargetScoreDraft] = useState('100');
  const [duration, setDuration] = useState(20);
  const [durationDraft, setDurationDraft] = useState('20');
  const [rounds, setRounds] = useState(1);
  const [roundsDraft, setRoundsDraft] = useState('1');
  const [showAnswers, setShowAnswers] = useState(true);
  const [categories, setCategories] = useState<Category[]>(sampleCategories);
  const [categoryInput, setCategoryInput] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const [players, setPlayers] = useState<Player[]>([]);
  const [playerUuid, setPlayerUuid] = useState<string>('');
  const [gameState, setGameState] = useState<'WAITING' | 'PLAYING' | 'FINISHED'>('WAITING');
  const [wsReady, setWsReady] = useState(false);

  // Game state
  const [currentQuestion, setCurrentQuestion] = useState<CurrentQuestion | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [myAnswer, setMyAnswer] = useState('');
  const [hasAnsweredCorrectly, setHasAnsweredCorrectly] = useState(false);
  const [timeUp, setTimeUp] = useState(false);
  const [correctAnswer, setCorrectAnswer] = useState<string | null>(null);
  const [lastWrongAnswer, setLastWrongAnswer] = useState<Record<string, string>>({});
  const [correctPlayerUuids, setCorrectPlayerUuids] = useState<Set<string>>(new Set());
  const [currentRound, setCurrentRound] = useState(1);
  const [roundWins, setRoundWins] = useState<Record<string, number>>({});
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [winner, setWinner] = useState<{ player_uuid: string; pseudo: string; rounds_won: number } | null>(null);
  const [roundWonInfo, setRoundWonInfo] = useState<{ pseudo: string; round: number } | null>(null);

  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [guestPseudo, setGuestPseudo] = useState<string | null>(null);
  const [pseudoDraft, setPseudoDraft] = useState('');

  const timerRef = useRef<number | null>(null);
  const answerInputRef = useRef<HTMLInputElement>(null);

  const isOwner = useMemo(
    () => players.some((p) => p.player_uuid === playerUuid && p.is_owner),
    [players, playerUuid],
  );

  const sendWsMessage = useCallback((msg: object) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const container = chatEndRef.current?.parentElement;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [chatMessages]);

  // Timer countdown
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (currentQuestion && timeLeft > 0 && !timeUp) {
      timerRef.current = window.setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentQuestion, timeUp]);

  useEffect(() => {
    if (currentQuestion && !hasAnsweredCorrectly && !timeUp) {
      setTimeout(() => answerInputRef.current?.focus(), 100);
    }
  }, [currentQuestion, hasAnsweredCorrectly, timeUp]);

  useEffect(() => {
    if (authLoading) return;
    if (!user && !localStorage.getItem('poppy.guest.pseudo')) {
      setGuestPseudo(null);
      return;
    }
    setGuestPseudo(user?.username ?? localStorage.getItem('poppy.guest.pseudo'));
  }, [authLoading, user]);

  useEffect(() => {
    if (!roomCode) return;
    if (authLoading) return;
    if (!user && guestPseudo === null) return;

    const guestKey = 'poppy.guest.uuid';

    const uuid = user?.uuid ?? (localStorage.getItem(guestKey) || crypto.randomUUID());
    const pseudo = user?.username ?? guestPseudo ?? 'Invité';

    if (!user) {
      localStorage.setItem(guestKey, uuid);
    }

    setPlayerUuid(uuid);

    const apiBase = import.meta.env.VITE_API_URL ?? 'http://82.67.196.38:8081';
    const wsBase = apiBase.startsWith('https://') ? apiBase.replace(/^https:/, 'wss:') : apiBase.replace(/^http:/, 'ws:');
    const wsUrl = `${wsBase}/ws/rooms/${encodeURIComponent(roomCode)}?player_uuid=${encodeURIComponent(
      uuid,
    )}&pseudo=${encodeURIComponent(pseudo)}`;

    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'room_state':
            setPlayers(msg.players ?? []);
            setWsReady(true);
            if (msg.game_state === 'PLAYING') setGameState('PLAYING');
            else if (msg.game_state === 'FINISHED') setGameState('FINISHED');
            else setGameState('WAITING');
            if (msg.configurations) {
              setTargetScore(msg.configurations.score_objective);
              setTargetScoreDraft(String(msg.configurations.score_objective));
              setDuration(msg.configurations.question_duration);
              setDurationDraft(String(msg.configurations.question_duration));
              setRounds(msg.configurations.rounds_to_win);
              setRoundsDraft(String(msg.configurations.rounds_to_win));
              if (msg.configurations.show_answers !== undefined) {
                setShowAnswers(msg.configurations.show_answers);
              }
            }
            if (msg.current_question) {
              const cq = msg.current_question;
              setCurrentQuestion({
                question: cq.question,
                question_type: cq.question_type,
                image_url: cq.image_url,
                time_limit: cq.time_limit,
                round: cq.round,
                question_index: cq.question_index,
                total_questions: cq.total_questions,
              });
              setTimeLeft(cq.time_limit);
              setCurrentRound(cq.round);
              setHasAnsweredCorrectly(false);
              setTimeUp(false);
            setCorrectAnswer(null);
              setMyAnswer('');
              setLastWrongAnswer({});
              if (msg.answered_players) {
                const correctSet = new Set<string>();
                for (const ap of msg.answered_players) {
                  if (ap.is_correct) correctSet.add(ap.player_uuid);
                }
                setCorrectPlayerUuids(correctSet);
                if (correctSet.has(uuid)) setHasAnsweredCorrectly(true);
              }
            }
            if (msg.round_wins) setRoundWins(msg.round_wins);
            break;

          case 'game_started':
            setGameState('PLAYING');
            setConfigOpen(false);
            setLeaderboard([]);
            setWinner(null);
            setRoundWins({});
            setCurrentRound(1);
            setCorrectPlayerUuids(new Set());
            setLastWrongAnswer({});
            setHasAnsweredCorrectly(false);
            setTimeUp(false);
            setCorrectAnswer(null);
            setRoundWonInfo(null);
            break;

          case 'new_question':
            setCurrentQuestion({
              question: msg.question,
              question_type: msg.question_type,
              image_url: msg.image_url,
              time_limit: msg.time_limit,
              round: msg.round,
              question_index: msg.question_index,
              total_questions: msg.total_questions,
            });
            setTimeLeft(msg.time_limit);
            setCurrentRound(msg.round);
            setMyAnswer('');
            setHasAnsweredCorrectly(false);
            setTimeUp(false);
            setCorrectAnswer(null);
            setLastWrongAnswer({});
            setCorrectPlayerUuids(new Set());
            setRoundWonInfo(null);
            break;

          case 'player_answered':
            if (msg.is_correct) {
              setCorrectPlayerUuids((prev) => new Set(prev).add(msg.player_uuid));
              if (msg.player_uuid === uuid) {
                setHasAnsweredCorrectly(true);
              }
            }
            setPlayers((prev) =>
              prev.map((p) =>
                p.player_uuid === msg.player_uuid ? { ...p, points: msg.total_points } : p,
              ),
            );
            if (!msg.is_correct && msg.answer) {
              setLastWrongAnswer((prev) => ({ ...prev, [msg.player_uuid]: msg.answer }));
            }
            break;

          case 'all_answered':
            setCorrectAnswer(msg.correct_answer ?? null);
            break;

          case 'time_up':
            setTimeUp(true);
            setTimeLeft(0);
            setCorrectAnswer(msg.correct_answer ?? null);
            break;

          case 'round_won':
            setRoundWins(msg.round_wins ?? {});
            setRoundWonInfo({ pseudo: msg.pseudo, round: msg.round });
            setPlayers((prev) => prev.map((p) => ({ ...p, points: 0 })));
            break;

          case 'game_finished':
            setGameState('FINISHED');
            setLeaderboard(msg.leaderboard ?? []);
            setWinner(msg.winner ?? null);
            break;

          case 'game_reset':
            setGameState('WAITING');
            setCurrentQuestion(null);
            setLeaderboard([]);
            setWinner(null);
            setRoundWins({});
            setCurrentRound(1);
            setCorrectPlayerUuids(new Set());
            setLastWrongAnswer({});
            setHasAnsweredCorrectly(false);
            setTimeUp(false);
            setCorrectAnswer(null);
            setRoundWonInfo(null);
            setPlayers((prev) => prev.map((p) => ({ ...p, points: 0 })));
            break;

          case 'player_join':
            if (msg.player) {
              setPlayers((prev) => {
                const exists = prev.some((p) => p.player_uuid === msg.player.player_uuid);
                if (exists) {
                  return prev.map((p) =>
                    p.player_uuid === msg.player.player_uuid ? { ...p, ...msg.player } : p,
                  );
                }
                return [...prev, msg.player];
              });
            }
            break;

          case 'player_leave':
            if (msg.player_uuid) {
              setPlayers((prev) => prev.filter((p) => p.player_uuid !== msg.player_uuid));
            }
            break;

          case 'config_update':
            if (msg.configurations) {
              setTargetScore(msg.configurations.score_objective);
              setTargetScoreDraft(String(msg.configurations.score_objective));
              setDuration(msg.configurations.question_duration);
              setDurationDraft(String(msg.configurations.question_duration));
              setRounds(msg.configurations.rounds_to_win);
              setRoundsDraft(String(msg.configurations.rounds_to_win));
              if (msg.configurations.show_answers !== undefined) {
                setShowAnswers(msg.configurations.show_answers);
              }
            }
            break;

          case 'chat_message':
            setChatMessages((prev) => [...prev.slice(-99), {
              player_uuid: msg.player_uuid,
              pseudo: msg.pseudo ?? 'Anonyme',
              text: msg.text,
              timestamp: msg.timestamp,
            }]);
            break;

          case 'error':
            alert(msg.message);
            break;
        }
      } catch {
      }
    });

    socket.addEventListener('close', (event) => {
      if (event.code === 4404) {
        navigate('/public-games');
      }
    });

    const ping = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 8000);

    return () => {
      window.clearInterval(ping);
      try {
        socket.close();
      } catch {
        // ignore
      }
      socketRef.current = null;
      setWsReady(false);
    };
  }, [authLoading, guestPseudo, navigate, roomCode, user]);

  const toggleMode = (id: string) => {
    setCategories((prev) =>
      prev.map((cat) =>
        cat.id === id ? { ...cat, mode: cat.mode === 'uniquement' ? 'enlever' : 'uniquement' } : cat,
      ),
    );
  };

  const removeCategory = (id: string) => setCategories((prev) => prev.filter((cat) => cat.id !== id));

  const addCategoryFromName = (name: string) => {
    setCategories((prev) => {
      if (prev.some((cat) => cat.name.toLowerCase() === name.toLowerCase())) return prev;
      return [...prev, { id: crypto.randomUUID(), name, mode: 'uniquement' }];
    });
    setCategoryInput('');
  };

  const addCategory = () => {
    if (!categoryInput.trim()) return;
    addCategoryFromName(categoryInput.trim());
    setDropdownOpen(false);
  };

  const categoryCount = useMemo(() => categories.length, [categories]);
  const availableCategories = useMemo(() => {
    const normalized = categoryInput.trim().toLowerCase();
    return CATEGORY_POOL.filter(
      (name) => !categories.some((cat) => cat.name.toLowerCase() === name.toLowerCase()),
    ).filter((name) => (!normalized ? true : name.toLowerCase().includes(normalized)));
  }, [categories, categoryInput]);

  const handleSuggestionClick = (name: string) => {
    addCategoryFromName(name);
    setDropdownOpen(false);
  };

  const openDropdown = () => setDropdownOpen(true);

  const handleTargetBlur = () => {
    const clamped = clampInput(targetScoreDraft, 10, 1500, targetScore);
    setTargetScore(clamped);
    setTargetScoreDraft(String(clamped));
    if (isOwner) sendWsMessage({ type: 'update_config', data: { score_objective: clamped } });
  };

  const handleDurationBlur = () => {
    const clamped = clampInput(durationDraft, 5, 60, duration);
    setDuration(clamped);
    setDurationDraft(String(clamped));
    if (isOwner) sendWsMessage({ type: 'update_config', data: { question_duration: clamped } });
  };

  const handleRoundsBlur = () => {
    const clamped = clampInput(roundsDraft, 1, 50, rounds);
    setRounds(clamped);
    setRoundsDraft(String(clamped));
    if (isOwner) sendWsMessage({ type: 'update_config', data: { rounds_to_win: clamped } });
  };

  const handleSubmitAnswer = () => {
    if (!myAnswer.trim() || hasAnsweredCorrectly || timeUp) return;
    sendWsMessage({ type: 'submit_answer', answer: myAnswer.trim() });
    setMyAnswer('');
  };

  const handleSendChat = () => {
    const text = chatInput.trim();
    if (!text) return;
    sendWsMessage({ type: 'chat_message', text });
    setChatInput('');
  };

  const handlePlayerClick = useCallback((player: Player) => {
    if (selectedPlayer?.player_uuid === player.player_uuid) {
      setSelectedPlayer(null);
      return;
    }
    setSelectedPlayer(player);
    setUserProfile(null);
    setProfileLoading(true);
    request<UserProfile>(`/users/${player.player_uuid}`)
      .then((data) => setUserProfile(data))
      .catch(() => setUserProfile(null))
      .finally(() => setProfileLoading(false));
  }, [selectedPlayer]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        setSelectedPlayer(null);
      }
    };
    if (selectedPlayer) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [selectedPlayer]);

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => b.points - a.points),
    [players],
  );

  // --- Render ---

  const renderPlayingScreen = () => (
    <div className="game-screen">
      {/* Header */}
      <div className="game-header">
        <div className="game-header__left">
          <span className="game-round-badge">Round {currentRound}</span>
          {currentQuestion && (
            <span className="game-question-count">
              Question {currentQuestion.question_index + 1}
            </span>
          )}
        </div>
        <div className={`game-timer ${timeLeft <= 5 ? 'game-timer--danger' : ''}`}>
          {timeLeft}s
        </div>
      </div>

      {/* Round won overlay */}
      {roundWonInfo && (
        <div className="round-won-banner">
          {roundWonInfo.pseudo} a remporté le round {roundWonInfo.round} !
        </div>
      )}

      {/* Question */}
      {currentQuestion && (
        <div className="game-question-area">
          {currentQuestion.image_url && (
            <img src={currentQuestion.image_url} alt="" className="game-question-image" />
          )}
          <h2 className="game-question-text">{currentQuestion.question}</h2>
        </div>
      )}

      {/* Answer input */}
      {timeUp ? (
        <div className="game-timeup-msg">
          Temps écoulé !{correctAnswer && <> La réponse était : <strong>{correctAnswer}</strong></>}
        </div>
      ) : hasAnsweredCorrectly ? (
        <div className="game-found-msg">
          Bonne réponse !{correctAnswer ? <> C'était : <strong>{correctAnswer}</strong></> : ' En attente des autres...'}
        </div>
      ) : (
        <div className="game-answer-area">
          <input
            ref={answerInputRef}
            type="text"
            className="game-answer-input"
            value={myAnswer}
            onChange={(e) => setMyAnswer(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmitAnswer()}
            placeholder="Tapez votre réponse..."
            autoComplete="off"
          />
          <button type="button" className="game-answer-btn" onClick={handleSubmitAnswer}>
            ENVOYER
          </button>
        </div>
      )}

    </div>
  );

  const renderFinishedScreen = () => (
    <div className="game-finished-screen">
      <h2 className="finished-title">Partie terminée !</h2>
      {winner && (
        <div className="finished-winner">
          {winner.pseudo} remporte la partie ({winner.rounds_won} round{winner.rounds_won > 1 ? 's' : ''} gagné{winner.rounds_won > 1 ? 's' : ''})
        </div>
      )}
      <div className="podium">
        {leaderboard.slice(0, 3).map((entry) => (
          <div key={entry.player_uuid} className={`podium-entry podium-rank-${entry.rank}`}>
            <div className="podium-rank">#{entry.rank}</div>
            <div className="podium-pseudo">{entry.pseudo}</div>
            <div className="podium-stats">
              {entry.points} pts &middot; {entry.rounds_won} round{entry.rounds_won !== 1 ? 's' : ''}
            </div>
          </div>
        ))}
      </div>
      <p className="finished-hint">Retour au lobby dans quelques secondes...</p>
    </div>
  );

  const renderWaitingScreen = () => (
    <>
      <div className="stage-content">
        <div className="placeholder-box">
          <span className="status-dot pulsing" />
          <h2>{roomCode ? `Room ${roomCode}` : 'En attente de lancement'}</h2>
          <p>{isOwner ? 'Lancez la partie quand tout le monde est prêt !' : "L'hôte configure la partie..."}</p>
        </div>
      </div>
      <div className="stage-footer">
        {isOwner ? (
          <button
            type="button"
            className="btn-join"
            onClick={() => sendWsMessage({ type: 'start_game' })}
          >
            LANCER LA PARTIE
          </button>
        ) : (
          <p className="waiting-text">En attente du lancement...</p>
        )}
      </div>
    </>
  );

  const truncate = (text: string, max: number) =>
    text.length > max ? text.slice(0, max) + '...' : text;

  const renderPlayersList = () => (
    <div className="sidebar-section players-list-section" style={{ position: 'relative' }}>
      <div className="section-header">
        <h4>JOUEURS <span className="dimmed">({players.length})</span></h4>
      </div>

      {selectedPlayer && (
        <div className="player-profile-popup" ref={popupRef}>
          <div className="profile-popup__header">
            <div className="profile-popup__name">
              <span>{selectedPlayer.pseudo ?? 'Anonyme'}</span>
              {selectedPlayer.is_owner && <span className="host-badge">Hôte</span>}
            </div>
            <button type="button" className="profile-popup__close" onClick={() => setSelectedPlayer(null)}>
              ✕
            </button>
          </div>

          <div className="profile-popup__section">
            <h5 className="profile-popup__section-title">Room</h5>
            {gameState === 'PLAYING' && (
              <div className="profile-popup__row">
                <span className="profile-popup__label">Points</span>
                <span className="profile-popup__value">{selectedPlayer.points}</span>
              </div>
            )}
            <div className="profile-popup__row">
              <span className="profile-popup__label">Rounds gagnés</span>
              <span className="profile-popup__value">{roundWins[selectedPlayer.player_uuid] ?? 0}</span>
            </div>
          </div>

          <div className="profile-popup__section">
            <h5 className="profile-popup__section-title">Compte</h5>
            {profileLoading ? (
              <span className="profile-popup__label">Chargement...</span>
            ) : userProfile ? (
              <>
                <div className="profile-popup__row">
                  <span className="profile-popup__label">Pseudo</span>
                  <span className="profile-popup__value">{userProfile.username}</span>
                </div>
                <div className="profile-popup__row">
                  <span className="profile-popup__label">Niveau</span>
                  <span className="profile-popup__value">{userProfile.level}</span>
                </div>
                <div className="profile-popup__row">
                  <span className="profile-popup__label">Temps de jeu</span>
                  <span className="profile-popup__value">{formatPlaytime(userProfile.playtime)}</span>
                </div>
              </>
            ) : (
              <span className="profile-popup__guest-badge">Joueur invité</span>
            )}
          </div>
        </div>
      )}

      <div className="players-grid">
        {sortedPlayers.map((player) => {
          const isCorrect = correctPlayerUuids.has(player.player_uuid);
          const wrongAnswer = lastWrongAnswer[player.player_uuid];
          return (
            <div
              key={player.player_uuid}
              className={`player-row ${isCorrect && gameState === 'PLAYING' ? 'player-row--correct' : ''} ${selectedPlayer?.player_uuid === player.player_uuid ? 'player-row--selected' : ''}`}
              onClick={() => handlePlayerClick(player)}
              style={{ cursor: 'pointer' }}
            >
              <div className={`avatar ${player.is_owner ? 'host' : ''}`}>
                {(player.pseudo ?? '?').charAt(0)}
              </div>
              <div className="player-info">
                <div className="player-info__top">
                  <span className="player-name">{player.pseudo ?? 'Anonyme'}</span>
                  {player.is_owner && <span className="host-badge">Hôte</span>}
                  {roundWins[player.player_uuid] > 0 && (
                    <span className="round-wins-badge">{roundWins[player.player_uuid]}R</span>
                  )}
                </div>
                {gameState === 'PLAYING' && wrongAnswer && !isCorrect && (
                  <span className="player-wrong-answer">{truncate(wrongAnswer, 25)}</span>
                )}
              </div>
              {gameState === 'PLAYING' && (
                <span className="player-points">{player.points}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const handlePseudoConfirm = () => {
    const name = pseudoDraft.trim();
    if (!name || name.length < 2) return;
    localStorage.setItem('poppy.guest.pseudo', name);
    setGuestPseudo(name);
  };

  if (!user && guestPseudo === null && !authLoading) {
    return (
      <div className="lobby-shell is-config-closed">
        <main className="lobby-stage">
          <div className="stage-content">
            <div className="pseudo-popup">
              <h2>Choisis ton pseudo</h2>
              <p>Comment veux-tu apparaître dans la partie ?</p>
              <input
                type="text"
                className="pseudo-popup__input"
                value={pseudoDraft}
                onChange={(e) => setPseudoDraft(e.target.value.slice(0, 20))}
                onKeyDown={(e) => e.key === 'Enter' && handlePseudoConfirm()}
                placeholder="Pseudo..."
                maxLength={20}
                autoFocus
              />
              <button
                type="button"
                className="btn-join"
                onClick={handlePseudoConfirm}
                disabled={pseudoDraft.trim().length < 2}
              >
                REJOINDRE
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!wsReady) {
    return (
      <div className="lobby-shell is-config-closed">
        <main className="lobby-stage">
          <div className="stage-content">
            <div className="placeholder-box">
              <span className="status-dot pulsing" />
              <h2>Connexion...</h2>
              <p>Connexion à la room {roomCode}</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={`lobby-shell ${configOpen ? 'is-config-open' : 'is-config-closed'}`}>
      <aside className="lobby-sidebar config-pane">
        <div className="sidebar-header">
          {configOpen ? (
            <>
              <div className="header-title">
                <span className="eyebrow">ADMIN</span>
                <h3>Paramètres</h3>
              </div>
              <button
                type="button"
                className="btn-icon-square"
                onClick={() => setConfigOpen(false)}
                title="Fermer la configuration"
              >
                <IconChevronLeft />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-icon-square main-toggle"
              onClick={() => setConfigOpen(true)}
              title="Ouvrir la configuration"
            >
              <IconGear />
            </button>
          )}
        </div>

        <div className={`config-scroller ${!configOpen ? 'hidden' : ''}`}>
          <div className="config-group">
            <h4 className="group-title">Règles</h4>
            <div className="fields-grid">
              <Field
                label="Objectif"
                type="number"
                value={targetScoreDraft}
                onChange={setTargetScoreDraft}
                onBlur={handleTargetBlur}
                placeholder="100"
              />
              <Field
                label="Temps (s)"
                type="number"
                value={durationDraft}
                onChange={setDurationDraft}
                onBlur={handleDurationBlur}
                placeholder="20"
              />
              <Field
                label="Rounds"
                type="number"
                value={roundsDraft}
                onChange={setRoundsDraft}
                onBlur={handleRoundsBlur}
                placeholder="1"
              />
            </div>

            {isOwner && (
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={showAnswers}
                  onChange={(e) => {
                    setShowAnswers(e.target.checked);
                    sendWsMessage({ type: 'update_config', data: { show_answers: e.target.checked } });
                  }}
                />
                <span className="toggle-label">Montrer les mauvaises réponses</span>
              </label>
            )}

            {isOwner && gameState === 'PLAYING' && (
              <button
                type="button"
                className="btn-end-game"
                onClick={() => {
                  if (window.confirm('Terminer la partie ? Tous les joueurs seront renvoyés au lobby.')) {
                    sendWsMessage({ type: 'end_game' });
                  }
                }}
              >
                Terminer la partie
              </button>
            )}
          </div>

          {gameState === 'WAITING' && (
            <div className="config-group">
              <div className="group-header">
                <h4 className="group-title">Catégories</h4>
                <span className="badge-count">{categoryCount}</span>
              </div>

              <div className="category-list">
                {categories.map((cat) => (
                  <div key={cat.id} className="category-item">
                    <span className="cat-name">{cat.name}</span>
                    <div className="cat-actions">
                      <button
                        type="button"
                        className={`btn-mode ${cat.mode}`}
                        onClick={() => toggleMode(cat.id)}
                      >
                        {cat.mode === 'uniquement' ? 'UNIQUEMENT' : 'EXCLURE'}
                      </button>
                      <button type="button" className="btn-remove" onClick={() => removeCategory(cat.id)}>
                        X
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="add-category" ref={dropdownRef}>
                <input
                  type="text"
                  value={categoryInput}
                  onChange={(e) => setCategoryInput(e.target.value)}
                  placeholder="Nouvelle catégorie..."
                  onFocus={openDropdown}
                  onClick={openDropdown}
                  onKeyDown={(e) => e.key === 'Enter' && addCategory()}
                />
                <button type="button" onClick={addCategory}>+</button>
                {dropdownOpen ? (
                  <div className="category-suggestions">
                    {availableCategories.length > 0 ? (
                      availableCategories.map((name) => (
                        <button
                          key={name}
                          type="button"
                          className="category-suggestions__item"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleSuggestionClick(name)}
                        >
                          {name}
                        </button>
                      ))
                    ) : (
                      <div className="category-suggestions__empty">Aucune catégorie disponible</div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </aside>

      <main className="lobby-stage">
        {gameState === 'FINISHED' ? (
          <div className="stage-content">{renderFinishedScreen()}</div>
        ) : gameState === 'PLAYING' ? (
          <div className="stage-content">{renderPlayingScreen()}</div>
        ) : (
          renderWaitingScreen()
        )}
      </main>

      <aside className="lobby-sidebar players-pane">
        {renderPlayersList()}

        <div className="sidebar-section chat-section">
          <div className="section-header">
            <h4>CHAT</h4>
          </div>
          <div className="chat-messages">
            {chatMessages.map((msg, i) => (
              <div key={i} className={`chat-msg ${msg.player_uuid === playerUuid ? 'chat-msg--me' : ''}`}>
                <span className="chat-msg__pseudo">{msg.pseudo}</span>
                <span className="chat-msg__text">{msg.text}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="chat-input-area">
            <input
              type="text"
              className="chat-input"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
              placeholder="Message..."
              maxLength={300}
            />
            <button type="button" className="chat-send-btn" onClick={handleSendChat}>
              &rarr;
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

export default LobbyPage;
