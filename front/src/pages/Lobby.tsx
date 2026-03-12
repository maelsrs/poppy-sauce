import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
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
  player_uuid: string | null;
  pseudo: string;
  text: string;
  timestamp: number;
  system?: boolean;
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
  'Grand public', 'Facile', 'Moyen', 'Difficile',
  '1940s', '1950s', '1960s', '1970s', '1980s', '1990s',
  'Animaux', 'Anime & Manga', 'Architecture', 'Art', 'Associations',
  'Bandes dessinées', 'Belgique', 'Capitales', 'Catch', 'Chanson française',
  'Dessins animés', 'Drapeaux', 'Drapeaux locaux',
  'Films', "Films d'animation", 'Football', 'Fruits & légumes',
  'Game of Thrones', 'Géographie',
  'Héraldique', 'Images', 'Informatique', 'Internet & Mèmes',
  'J-pop', 'Jeux de société', 'Jeux indé', 'Jeux vidéo',
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
  const [configOpen, setConfigOpen] = useState(false);
  const configInitRef = useRef(false);
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
  const socketRef = useRef<Socket | null>(null);

  const [players, setPlayers] = useState<Player[]>([]);
  const [playerUuid, setPlayerUuid] = useState<string>('');
  const [gameState, setGameState] = useState<'WAITING' | 'PLAYING' | 'FINISHED'>('WAITING');
  const [wsReady, setWsReady] = useState(false);
  const [roomNotFound, setRoomNotFound] = useState(false);

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

  useEffect(() => {
    if (players.length > 0 && !configInitRef.current) {
      configInitRef.current = true;
      if (isOwner) setConfigOpen(true);
    }
  }, [players, isOwner]);

  const sendWsMessage = useCallback((event: string, data?: object) => {
    const socket = socketRef.current;
    if (socket && socket.connected) {
      socket.emit(event, data);
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

    const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:8081';

    const socket = io(apiBase, {
      path: '/socket.io/',
      query: { room_code: roomCode, player_uuid: uuid, pseudo },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });
    socketRef.current = socket;

    socket.on('room_state', (msg) => {
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
        if (msg.configurations.categories) {
          setCategories(msg.configurations.categories.map((c: { name: string; mode: string }) => ({
            id: crypto.randomUUID(),
            name: c.name,
            mode: c.mode as CategoryMode,
          })));
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
    });

    socket.on('game_started', () => {
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
    });

    socket.on('new_question', (msg) => {
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
    });

    socket.on('player_answered', (msg) => {
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
    });

    socket.on('all_answered', (msg) => {
      setCorrectAnswer(msg.correct_answer ?? null);
    });

    socket.on('time_up', (msg) => {
      setTimeUp(true);
      setTimeLeft(0);
      setCorrectAnswer(msg.correct_answer ?? null);
    });

    socket.on('round_won', (msg) => {
      setRoundWins(msg.round_wins ?? {});
      setRoundWonInfo({ pseudo: msg.pseudo, round: msg.round });
      setPlayers((prev) => prev.map((p) => ({ ...p, points: 0 })));
    });

    socket.on('game_finished', (msg) => {
      setGameState('FINISHED');
      setLeaderboard(msg.leaderboard ?? []);
      setWinner(msg.winner ?? null);
    });

    socket.on('game_reset', () => {
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
    });

    socket.on('player_join', (msg) => {
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
    });

    socket.on('player_leave', (msg) => {
      if (msg.player_uuid) {
        setPlayers((prev) => prev.filter((p) => p.player_uuid !== msg.player_uuid));
      }
    });

    socket.on('config_update', (msg) => {
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
        if (msg.configurations.categories) {
          setCategories(msg.configurations.categories.map((c: { name: string; mode: string }) => ({
            id: crypto.randomUUID(),
            name: c.name,
            mode: c.mode as CategoryMode,
          })));
        }
      }
    });

    socket.on('chat_message', (msg) => {
      setChatMessages((prev) => [...prev.slice(-99), {
        player_uuid: msg.player_uuid ?? null,
        pseudo: msg.pseudo ?? 'Anonyme',
        text: msg.text,
        timestamp: msg.timestamp,
        system: msg.system ?? false,
      }]);
    });

    socket.on('error', (msg) => {
      alert(msg.message);
    });

    socket.on('connect_error', (err) => {
      if (err.message === 'Room introuvable') {
        setRoomNotFound(true);
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setWsReady(false);
    };
  }, [authLoading, guestPseudo, navigate, roomCode, user]);

  const syncCategories = (cats: Category[]) => {
    if (isOwner) sendWsMessage('update_config', {
      categories: cats.map((c) => ({ name: c.name, mode: c.mode })),
    });
  };

  const toggleMode = (id: string) => {
    setCategories((prev) => {
      const next = prev.map((cat) =>
        cat.id === id ? { ...cat, mode: (cat.mode === 'uniquement' ? 'enlever' : 'uniquement') as CategoryMode } : cat,
      );
      syncCategories(next);
      return next;
    });
  };

  const removeCategory = (id: string) => {
    setCategories((prev) => {
      const next = prev.filter((cat) => cat.id !== id);
      syncCategories(next);
      return next;
    });
  };

  const addCategoryFromName = (name: string) => {
    setCategories((prev) => {
      if (prev.some((cat) => cat.name.toLowerCase() === name.toLowerCase())) return prev;
      const next = [...prev, { id: crypto.randomUUID(), name, mode: 'uniquement' as CategoryMode }];
      syncCategories(next);
      return next;
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
    if (isOwner) sendWsMessage('update_config', { score_objective: clamped });
  };

  const handleDurationBlur = () => {
    const clamped = clampInput(durationDraft, 5, 60, duration);
    setDuration(clamped);
    setDurationDraft(String(clamped));
    if (isOwner) sendWsMessage('update_config', { question_duration: clamped });
  };

  const handleRoundsBlur = () => {
    const clamped = clampInput(roundsDraft, 1, 50, rounds);
    setRounds(clamped);
    setRoundsDraft(String(clamped));
    if (isOwner) sendWsMessage('update_config', { rounds_to_win: clamped });
  };

  const handleSubmitAnswer = () => {
    if (!myAnswer.trim() || hasAnsweredCorrectly || timeUp) return;
    sendWsMessage('submit_answer', { answer: myAnswer.trim() });
    setMyAnswer('');
  };

  const handleSendChat = () => {
    const text = chatInput.trim();
    if (!text) return;
    sendWsMessage('chat_message', { text });
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
            onClick={() => sendWsMessage('start_game')}
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

  if (roomNotFound) {
    return (
      <div className="lobby-shell is-config-closed">
        <main className="lobby-stage">
          <div className="stage-content">
            <div className="placeholder-box">
              <h2>Cette partie n'existe pas</h2>
              <p>Le code <strong>{roomCode}</strong> ne correspond à aucune partie en cours.</p>
              <button
                type="button"
                className="btn-join"
                style={{ marginTop: 16 }}
                onClick={() => navigate('/')}
              >
                RETOUR À L'ACCUEIL
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
                disabled={!isOwner}
              />
              <Field
                label="Temps (s)"
                type="number"
                value={durationDraft}
                onChange={setDurationDraft}
                onBlur={handleDurationBlur}
                placeholder="20"
                disabled={!isOwner}
              />
              <Field
                label="Rounds"
                type="number"
                value={roundsDraft}
                onChange={setRoundsDraft}
                onBlur={handleRoundsBlur}
                placeholder="1"
                disabled={!isOwner}
              />
            </div>

            <label className={`toggle-row ${!isOwner ? 'toggle-row--disabled' : ''}`}>
              <input
                type="checkbox"
                checked={showAnswers}
                disabled={!isOwner}
                onChange={(e) => {
                  setShowAnswers(e.target.checked);
                  sendWsMessage('update_config', { show_answers: e.target.checked });
                }}
              />
              <span className="toggle-label">Montrer les mauvaises réponses</span>
            </label>

            {isOwner && gameState === 'PLAYING' && (
              <button
                type="button"
                className="btn-end-game"
                onClick={() => {
                  if (window.confirm('Terminer la partie ? Tous les joueurs seront renvoyés au lobby.')) {
                    sendWsMessage('end_game');
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
                  <div key={cat.id} className={`category-item ${!isOwner ? 'category-item--disabled' : ''}`}>
                    <span className="cat-name">{cat.name}</span>
                    {isOwner && (
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
                    )}
                    {!isOwner && (
                      <span className="cat-mode-label">{cat.mode === 'uniquement' ? 'UNIQUEMENT' : 'EXCLURE'}</span>
                    )}
                  </div>
                ))}
              </div>

              {isOwner && (
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
              )}
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
              msg.system ? (
                <div key={i} className="chat-msg chat-msg--system">
                  <span className="chat-msg__text">{msg.text}</span>
                </div>
              ) : (
                <div key={i} className={`chat-msg ${msg.player_uuid === playerUuid ? 'chat-msg--me' : ''}`}>
                  <span className="chat-msg__pseudo">{msg.pseudo}</span>
                  <span className="chat-msg__text">{msg.text}</span>
                </div>
              )
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
