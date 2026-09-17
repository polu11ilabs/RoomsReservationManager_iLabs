import { useEffect, useLayoutEffect, useRef, useState } from "react";
import DatePicker from "react-datepicker";
import { supabase } from "./supabaseClient";
import { it } from "date-fns/locale";
import "react-datepicker/dist/react-datepicker.css";
import "./index.css";

const getMonday = (date) => {
  const result = new Date(date);
  const day = result.getDay();
  const difference = day === 0 ? -6 : 1 - day;

  result.setDate(result.getDate() + difference);
  result.setHours(0, 0, 0, 0);

  return result;
};

const formatDateKey = (date) => {
  if (!date) return "";

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
};

const timeToMinutes = (time) => {
  if (!time) return 0;

  const [hours, minutes] = time.split(":").map(Number);

  return hours * 60 + minutes;
};

const minutesToTime = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
};

const normalizeTime = (time) => {
  if (!time) return "";

  return time.slice(0, 5);
};

const isWeekend = (date) => {
  if (!date) return false;

  const day = date.getDay();

  return day === 0 || day === 6;
};

const isBookingExpired = (booking) => {
  const [year, month, day] = booking.day.split("-").map(Number);

  const [endHour, endMinute] = booking.end.split(":").map(Number);

  const endDateTime = new Date(year, month - 1, day, endHour, endMinute, 0, 0);

  return endDateTime <= new Date();
};

const isBookingActive = (booking) => {
  const [year, month, day] = booking.day.split("-").map(Number);

  const [startHour, startMinute] = booking.start.split(":").map(Number);
  const [endHour, endMinute] = booking.end.split(":").map(Number);

  const startDateTime = new Date(
    year,
    month - 1,
    day,
    startHour,
    startMinute,
    0,
    0,
  );

  const endDateTime = new Date(year, month - 1, day, endHour, endMinute, 0, 0);

  const now = new Date();

  return now >= startDateTime && now < endDateTime;
};

const autoResizeTextarea = (element) => {
  if (!element) return;

  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
};

const computeHourFromPointer = (clientY, cellTop, startHour, rowHeights) => {
  let offset = clientY - cellTop;

  if (offset < 0) {
    return startHour;
  }

  let index = startHour - 8;

  while (index < rowHeights.length - 1 && offset >= rowHeights[index]) {
    offset -= rowHeights[index];
    index += 1;
  }

  return 8 + index;
};

const computeTimeFromPointer = (clientY, cellTop, startHour, rowHeight) => {
  /*
   * Il punto verticale del mouse NON determina più i minuti.
   *
   * Una cella rappresenta un'ora intera:
   * 13:00 -> 14:00
   *
   * Quindi il valore predefinito è sempre l'inizio dell'ora.
   */
  return `${String(startHour).padStart(2, "0")}:00`;
};

const isTimeUnavailable = (room, date, time) => {
  if (!room || !room.unavailability || room.unavailability.length === 0) {
    return false;
  }

  const dateKey = formatDateKey(date);

  const clickedDateTime = new Date(`${dateKey}T${time}:00`);

  return room.unavailability.some((period) => {
    const unavailableStart = new Date(period.startAt);

    // Il minuto immediatamente precedente
    // all'inizio dell'indisponibilità non è cliccabile.
    const clickBlockedFrom = new Date(unavailableStart.getTime() - 60 * 1000);

    if (!period.endAt) {
      return clickedDateTime >= clickBlockedFrom;
    }

    const unavailableEnd = new Date(period.endAt);

    return (
      clickedDateTime >= clickBlockedFrom && clickedDateTime < unavailableEnd
    );
  });
};

const isBookingIntervalUnavailable = (room, date, startTime, endTime) => {
  if (!room || !room.unavailability || room.unavailability.length === 0) {
    return false;
  }

  const dateKey = formatDateKey(date);

  const bookingStart = new Date(`${dateKey}T${startTime}:00`);

  const bookingEnd = new Date(`${dateKey}T${endTime}:00`);

  return room.unavailability.some((period) => {
    const unavailableStart = new Date(period.startAt);

    // ATTENZIONE:
    // qui NON sottraiamo un minuto.
    //
    // L'indisponibilità inizia esattamente
    // all'orario indicato.
    if (!period.endAt) {
      return bookingEnd > unavailableStart;
    }

    const unavailableEnd = new Date(period.endAt);

    return bookingStart < unavailableEnd && bookingEnd > unavailableStart;
  });
};

const isCalendarClickBlocked = (
  room,
  date,
  hour,
  clientY,
  cellTop,
  cellHeight,
) => {
  if (!room || !room.unavailability || room.unavailability.length === 0) {
    return false;
  }

  const dateKey = formatDateKey(date);

  /*
   * Calcoliamo la posizione REALE del mouse
   * all'interno della cella.
   */
  const ratio = Math.max(0, Math.min(1, (clientY - cellTop) / cellHeight));

  const clickedDateTime = new Date(date);

  clickedDateTime.setHours(hour, Math.floor(ratio * 60), 0, 0);

  /*
   * Controlliamo ogni indisponibilità.
   */
  return room.unavailability.some((period) => {
    const start = new Date(period.startAt);

    /*
     * Se l'indisponibilità appartiene
     * a un'altra data, il confronto continua
     * comunque correttamente tramite timestamp.
     */

    if (!period.endAt) {
      return clickedDateTime >= start;
    }

    const end = new Date(period.endAt);

    return clickedDateTime >= start && clickedDateTime < end;
  });
};

const REASON_CHARS_PER_LINE = 24;
const REASON_LINE_HEIGHT = 15;
const BOOKING_BASE_HEIGHT = 52;
const ROW_DEFAULT_HEIGHT = 60;

const estimateBookingContentHeight = (booking) => {
  if (!booking.reason) {
    return BOOKING_BASE_HEIGHT;
  }

  const lines = Math.max(
    1,
    Math.ceil(booking.reason.length / REASON_CHARS_PER_LINE),
  );

  return BOOKING_BASE_HEIGHT + 5 + lines * REASON_LINE_HEIGHT;
};

const computeBookingBlockHeight = (booking, rowHeights) => {
  const startMinutes = timeToMinutes(booking.start);
  const endMinutes = timeToMinutes(booking.end);

  const startHour = Math.floor(startMinutes / 60);
  const endHourExclusive = Math.ceil(endMinutes / 60);

  let total = 0;

  for (let hour = startHour; hour < endHourExclusive; hour += 1) {
    const rowIndex = hour - 8;

    const rowHeight = rowHeights[rowIndex] ?? ROW_DEFAULT_HEIGHT;

    const hourStart = hour * 60;
    const hourEnd = (hour + 1) * 60;

    const overlapStart = Math.max(startMinutes, hourStart);
    const overlapEnd = Math.min(endMinutes, hourEnd);

    const fraction = (overlapEnd - overlapStart) / 60;

    total += rowHeight * fraction;
  }

  return Math.max(20, total - 8);
};

const computeBookingBlockOffset = (booking, rowHeights) => {
  const startMinutes = timeToMinutes(booking.start);

  const startHour = Math.floor(startMinutes / 60);
  const minutesIntoHour = startMinutes % 60;

  const rowIndex = startHour - 8;

  const rowHeight = rowHeights[rowIndex] ?? ROW_DEFAULT_HEIGHT;

  return (minutesIntoHour / 60) * rowHeight;
};

const dayNames = ["LUN", "MAR", "MER", "GIO", "VEN"];

function App() {
  /*
   * ============================================================
   * AUTENTICAZIONE
   * ============================================================
   */

  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [authMode, setAuthMode] = useState("login");

  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authFirstName, setAuthFirstName] = useState("");
  const [authLastName, setAuthLastName] = useState("");

  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const [showAddRoomModal, setShowAddRoomModal] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomDescription, setNewRoomDescription] = useState("");
  const [newRoomColor, setNewRoomColor] = useState("#2563eb");
  const [addingRoom, setAddingRoom] = useState(false);

  const [showEditRoomModal, setShowEditRoomModal] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);
  const [editRoomName, setEditRoomName] = useState("");
  const [editRoomDescription, setEditRoomDescription] = useState("");
  const [editRoomColor, setEditRoomColor] = useState("#2563eb");
  const [savingRoom, setSavingRoom] = useState(false);

    useEffect(() => {
    const handler = () => forceMinuteTick((t) => t + 1);
    window.addEventListener("showlogin", handler);
    return () => window.removeEventListener("showlogin", handler);
  }, []);


  /*
   * Recupero il profilo dell'utente autenticato.
   */

  const loadProfile = async (user) => {
    if (!user) {
      setProfile(null);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Errore caricamento profilo:", error);

      setProfile(null);
      setAuthError("Impossibile caricare il profilo utente.");

      return;
    }

    if (!data) {
      console.error("Profilo utente non trovato.");

      setProfile(null);
      setAuthError("Profilo utente non trovato.");

      return;
    }

    setProfile(data);
    setAuthError("");
  };

  /*
   * ============================================================
   * CONTROLLO SESSIONE
   * ============================================================
   */

  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      const {
        data: { session: currentSession },
        error,
      } = await supabase.auth.getSession();

      if (error) {
        console.error("Errore recupero sessione:", error);
      }

      if (!mounted) {
        return;
      }

      setSession(currentSession);

      if (currentSession?.user) {
        await loadProfile(currentSession.user);
      } else {
        setProfile(null);
      }

      if (mounted) {
        setAuthLoading(false);
      }
    };

    initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mounted) {
        return;
      }

      setSession(newSession);

      if (newSession?.user) {
        await loadProfile(newSession.user);
      } else {
        setProfile(null);
      }

      if (mounted) {
        setAuthLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  /*
   * ============================================================
   * REGISTRAZIONE
   * ============================================================
   */

  const handleRegister = async () => {
    setAuthError("");
    setAuthMessage("");

    if (!authFirstName.trim()) {
      setAuthError("Inserisci il nome.");
      return;
    }

    if (!authLastName.trim()) {
      setAuthError("Inserisci il cognome.");
      return;
    }

    if (!authEmail.trim()) {
      setAuthError("Inserisci l'email.");
      return;
    }

    if (!authPassword) {
      setAuthError("Inserisci una password.");
      return;
    }

    if (authPassword.length < 6) {
      setAuthError("La password deve contenere almeno 6 caratteri.");
      return;
    }

    if (authPassword !== authConfirmPassword) {
      setAuthError("Le password non coincidono.");
      return;
    }

    setAuthSubmitting(true);

    const { data, error } = await supabase.auth.signUp({
      email: authEmail.trim(),
      password: authPassword,
      options: {
        data: {
          first_name: authFirstName.trim(),
          last_name: authLastName.trim(),
        },
      },
    });

    if (error) {
      console.error("Errore registrazione:", error);

      setAuthError(error.message);

      setAuthSubmitting(false);

      return;
    }

    /*
     * Se la conferma email è disabilitata,
     * Supabase crea direttamente la sessione.
     */

    if (data.session && data.user) {
      await loadProfile(data.user);

      setAuthSubmitting(false);

      return;
    }

    /*
     * Se la conferma email è attiva,
     * mostriamo il messaggio.
     */

    setAuthMessage(
      "Registrazione completata. Controlla la tua email per confermare l'account.",
    );

    setAuthEmail("");
    setAuthPassword("");
    setAuthConfirmPassword("");
    setAuthFirstName("");
    setAuthLastName("");

    setAuthSubmitting(false);
  };

  /*
   * ============================================================
   * LOGIN
   * ============================================================
   */

  const handleLogin = async () => {
    setAuthError("");
    setAuthMessage("");

    if (!authEmail.trim()) {
      setAuthError("Inserisci l'email.");
      return;
    }

    if (!authPassword) {
      setAuthError("Inserisci la password.");
      return;
    }

    setAuthSubmitting(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: authEmail.trim(),
      password: authPassword,
    });

    if (error) {
      console.error("Errore login:", error);

      setAuthError("Email o password non corretti.");

      setAuthSubmitting(false);

      return;
    }

    if (data.user) {
      await loadProfile(data.user);
    }

    setAuthSubmitting(false);
  };

  /*
   * ============================================================
   * LOGOUT
   * ============================================================
   */

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Errore logout:", error);
      return;
    }

    setSession(null);
    setProfile(null);

    setAuthEmail("");
    setAuthPassword("");
    setAuthConfirmPassword("");
    setAuthFirstName("");
    setAuthLastName("");

    setAuthError("");
    setAuthMessage("");

    setAuthMode("login");
  };

  /*
   * ============================================================
   * AGGIORNAMENTO OGNI MINUTO
   * ============================================================
   */

  const [, forceMinuteTick] = useState(0);

  useEffect(() => {
    const intervalId = setInterval(() => {
      forceMinuteTick((tick) => tick + 1);
    }, 60000);

    return () => clearInterval(intervalId);
  }, []);

  /*
   * ============================================================
   * UTENTE ATTUALE
   * ============================================================
   */

  const currentUser =
    session?.user && profile
      ? {
          id: session.user.id,
          name:
            profile.first_name || profile.last_name
              ? `${profile.first_name || ""} ${profile.last_name || ""}`.trim()
              : session.user.email || "Utente",
          role: profile.role || "user",
        }
      : null;

  const isAdmin = currentUser?.role === "admin";

  /*
   * ============================================================
   * SALE
   * ============================================================
   */

  const [rooms, setRooms] = useState([]);

  const [loadingRooms, setLoadingRooms] = useState(true);

  const loadDataRequestRef = useRef(0);

  const [roomsError, setRoomsError] = useState("");

  const addRoom = async () => {
    if (!isAdmin) {
      return;
    }

    if (!newRoomName.trim()) {
      alert("Inserisci il nome della sala.");
      return;
    }

    setAddingRoom(true);

    const { data, error } = await supabase
      .from("rooms")
      .insert([
        {
          name: newRoomName.trim(),
          description: newRoomDescription.trim(),
          color: newRoomColor,
        },
      ])
      .select()
      .single();

    setAddingRoom(false);

    if (error) {
      console.error("Errore aggiunta sala:", error);
      alert(`Impossibile aggiungere la sala.\n\n${error.message}`);
      return;
    }

    setRooms((currentRooms) => {
      const newRoom = {
        ...data,
        bookings: [],
      };

      return [...currentRooms, newRoom];
    });

    setNewRoomName("");
    setNewRoomDescription("");
    setNewRoomColor("#2563eb");
    setShowAddRoomModal(false);
  };

  const updateRoom = async () => {
    if (!isAdmin || !editingRoom) {
      return;
    }

    if (!editRoomName.trim()) {
      alert("Inserisci il nome della sala.");
      return;
    }

    setSavingRoom(true);

    const { data, error } = await supabase
      .from("rooms")
      .update({
        name: editRoomName.trim(),
        description: editRoomDescription.trim(),
        color: editRoomColor,
      })
      .eq("id", editingRoom.id)
      .select()
      .single();

    setSavingRoom(false);

    if (error) {
      console.error("Errore modifica sala:", error);
      alert(`Impossibile modificare la sala.\n\n${error.message}`);
      return;
    }

    setRooms((currentRooms) =>
      currentRooms.map((room) =>
        room.id === editingRoom.id
          ? {
              ...room,
              ...data,
              bookings: room.bookings || [],
            }
          : room,
      ),
    );

    setEditingRoom(null);
    setEditRoomName("");
    setEditRoomDescription("");
    setEditRoomColor("#2563eb");
    setShowEditRoomModal(false);
  };

  const openRoomUnavailableModal = (roomId) => {
    const now = new Date();

    const roundedMinutes =
      Math.ceil((now.getMinutes() + now.getSeconds() / 60) / 5) * 5;

    const startDate = new Date(now);

    if (roundedMinutes >= 60) {
      startDate.setHours(startDate.getHours() + 1);
      startDate.setMinutes(0, 0, 0);
    } else {
      startDate.setMinutes(roundedMinutes, 0, 0);
    }

    setUnavailableRoomId(roomId);

    setUnavailableStartDate(startDate);

    setUnavailableStartTime(
      `${String(startDate.getHours()).padStart(2, "0")}:${String(
        startDate.getMinutes(),
      ).padStart(2, "0")}`,
    );

    const defaultEndDate = new Date(startDate);
    defaultEndDate.setHours(defaultEndDate.getHours() + 1);

    setUnavailableEndDate(defaultEndDate);

    setUnavailableEndTime(
      `${String(defaultEndDate.getHours()).padStart(2, "0")}:${String(
        defaultEndDate.getMinutes(),
      ).padStart(2, "0")}`,
    );

    setUnavailableUntilReactivated(false);
    setUnavailableError("");
    setSavingRoomUnavailable(false);

    setShowRoomUnavailable(true);
  };

  const saveRoomUnavailable = async () => {
    if (!isAdmin) return;

    setUnavailableError("");
    setSavingRoomUnavailable(true);

    try {
      if (!unavailableRoomId) {
        setUnavailableError("Sala non selezionata.");
        return;
      }

      if (!unavailableStartDate || !unavailableStartTime) {
        setUnavailableError(
          "Inserisci la data e l'ora di inizio dell'indisponibilità.",
        );
        return;
      }

      if (
        !unavailableUntilReactivated &&
        (!unavailableEndDate || !unavailableEndTime)
      ) {
        setUnavailableError(
          "Inserisci la data e l'ora di fine dell'indisponibilità.",
        );
        return;
      }

      /*
       * ============================================================
       * CONTROLLO GIORNI
       * ============================================================
       *
       * Le indisponibilità seguono le stesse regole
       * delle prenotazioni:
       *
       * - niente sabato
       * - niente domenica
       */

      if (isWeekend(unavailableStartDate)) {
        setUnavailableError(
          "Non è possibile impostare un'indisponibilità durante il sabato o la domenica.",
        );
        return;
      }

      if (!unavailableUntilReactivated && isWeekend(unavailableEndDate)) {
        setUnavailableError(
          "La data di fine dell'indisponibilità non può essere durante il sabato o la domenica.",
        );
        return;
      }

      /*
       * ============================================================
       * CREAZIONE DATA/ORA INIZIO
       * ============================================================
       */

      let startAt;
      const now = new Date();

      if (unavailableUntilReactivated) {
        /*
         * INDISPONIBILITÀ FINO A RIATTIVAZIONE
         *
         * L'inizio viene SEMPRE calcolato in base
         * all'ora attuale al momento del salvataggio.
         *
         * Arrotondiamo al successivo multiplo di 5 minuti
         * per evitare che l'orario risulti nel passato.
         */
        const roundedMinutes =
          Math.ceil((now.getMinutes() + now.getSeconds() / 60) / 5) * 5;

        startAt = new Date(now);

        if (roundedMinutes >= 60) {
          startAt.setHours(startAt.getHours() + 1);
          startAt.setMinutes(0, 0, 0);
        } else {
          startAt.setMinutes(roundedMinutes, 0, 0);
        }
      } else {
        /*
         * INDISPONIBILITÀ TEMPORANEA
         *
         * In questo caso utilizziamo normalmente
         * data e ora selezionate dall'amministratore.
         */
        startAt = new Date(unavailableStartDate);

        const [startHour, startMinute] = unavailableStartTime
          .split(":")
          .map(Number);

        startAt.setHours(startHour, startMinute, 0, 0);
      }

      if (startAt < now) {
        setUnavailableError(
          "La data e l'ora di inizio non possono essere nel passato.",
        );
        return;
      }

      /*
       * ============================================================
       * DATA/ORA FINE
       * ============================================================
       */

      let endAt = null;

      if (!unavailableUntilReactivated) {
        endAt = new Date(unavailableEndDate);

        const [endHour, endMinute] = unavailableEndTime.split(":").map(Number);

        endAt.setHours(endHour, endMinute, 0, 0);

        /*
         * ============================================================
         * CONTROLLO ORARIO FINE
         * ============================================================
         *
         * Come per le prenotazioni:
         *
         * minimo 08:00
         * massimo 18:00
         */

        const endMinutes = endHour * 60 + endMinute;

        if (endMinutes < 8 * 60 || endMinutes > 18 * 60) {
          setUnavailableError(
            "L'orario di fine deve essere compreso tra le 08:00 e le 18:00.",
          );
          return;
        }

        /*
         * ============================================================
         * CONTROLLO INTERVALLO
         * ============================================================
         */

        if (endAt <= startAt) {
          setUnavailableError(
            "La data e l'ora di fine devono essere successive all'inizio.",
          );
          return;
        }
      }

      /*
       * ============================================================
       * 1. CREAZIONE INDISPONIBILITÀ
       * ============================================================
       *
       * IMPORTANTE:
       *
       * Non controlliamo se esistono prenotazioni sovrapposte.
       *
       * L'indisponibilità ha la precedenza.
       */

      const { data: unavailableData, error: unavailableInsertError } =
        await supabase
          .from("room_unavailability")
          .insert({
            room_id: unavailableRoomId,
            start_at: startAt.toISOString(),
            end_at: endAt ? endAt.toISOString() : null,
            created_by: currentUser.id,
          })
          .select()
          .single();

      if (unavailableInsertError) {
        console.error(
          "Errore creazione indisponibilità:",
          unavailableInsertError,
        );

        setUnavailableError(
          "Impossibile impostare l'indisponibilità. Riprova.",
        );

        return;
      }

      /*
       * ============================================================
       * 2. TROVA LE PRENOTAZIONI SOVRAPPOSTE
       * ============================================================
       *
       * Una prenotazione è sovrapposta se:
       *
       * booking_start < unavailable_end
       * &&
       * booking_end > unavailable_start
       *
       * Per un'indisponibilità indefinita:
       *
       * booking_end > unavailable_start
       */

      const { data: roomBookings, error: bookingsError } = await supabase
        .from("bookings")
        .select("id, booking_date, start_time, end_time")
        .eq("room_id", unavailableRoomId);

      if (bookingsError) {
        console.error("Errore caricamento prenotazioni sala:", bookingsError);

        /*
         * L'indisponibilità è già stata creata.
         *
         * Non la cancelliamo se il caricamento delle prenotazioni
         * dovesse fallire.
         */

        await loadData();

        setShowRoomUnavailable(false);

        return;
      }

      /*
       * ============================================================
       * 3. INDIVIDUAZIONE PRENOTAZIONI DA ELIMINARE
       * ============================================================
       */

      const overlappingBookingIds = (roomBookings || [])
        .filter((booking) => {
          const bookingStart = new Date(
            `${booking.booking_date}T${normalizeTime(booking.start_time)}:00`,
          );

          const bookingEnd = new Date(
            `${booking.booking_date}T${normalizeTime(booking.end_time)}:00`,
          );

          /*
           * Indisponibilità indefinita:
           *
           * elimina qualsiasi prenotazione
           * che finisca dopo l'inizio
           * dell'indisponibilità.
           */

          if (!endAt) {
            return bookingEnd > startAt;
          }

          /*
           * Indisponibilità con fine:
           *
           * controlliamo la sovrapposizione
           * effettiva dei due intervalli.
           */

          return bookingStart < endAt && bookingEnd > startAt;
        })
        .map((booking) => booking.id);

      /*
       * ============================================================
       * 4. ELIMINAZIONE PRENOTAZIONI SOVRAPPOSTE
       * ============================================================
       */

      if (overlappingBookingIds.length > 0) {
        const { error: deleteBookingsError } = await supabase
          .from("bookings")
          .delete()
          .in("id", overlappingBookingIds);

        if (deleteBookingsError) {
          console.error(
            "Errore eliminazione prenotazioni sovrapposte:",
            deleteBookingsError,
          );

          /*
           * L'indisponibilità rimane comunque valida.
           */

          setUnavailableError(
            "Indisponibilità creata, ma non è stato possibile eliminare tutte le prenotazioni sovrapposte.",
          );

          await loadData();

          return;
        }
      }

      /*
       * ============================================================
       * 5. AGGIORNA LA PAGINA
       * ============================================================
       */

      await loadData();

      setShowRoomUnavailable(false);

      setUnavailableRoomId(null);
      setUnavailableStartDate(null);
      setUnavailableEndDate(null);
      setUnavailableStartTime("08:00");
      setUnavailableEndTime("18:00");
      setUnavailableUntilReactivated(false);
      setUnavailableError("");
    } catch (error) {
      console.error("Errore generale indisponibilità:", error);

      setUnavailableError(
        "Si è verificato un errore durante l'impostazione dell'indisponibilità.",
      );
    } finally {
      setSavingRoomUnavailable(false);
    }
  };

  const deleteRoomUnavailable = async (unavailabilityId) => {
    if (!isAdmin) {
      return;
    }

    const confirmed = window.confirm(
      "Vuoi davvero rimuovere questa indisponibilità?\n\n" +
        "L'intervallo verrà eliminato dallo storico.",
    );

    if (!confirmed) {
      return;
    }

    const { error } = await supabase
      .from("room_unavailability")
      .delete()
      .eq("id", unavailabilityId);

    if (error) {
      console.error("Errore eliminazione indisponibilità:", error);

      alert("Impossibile rimuovere l'indisponibilità. Riprova.");

      return;
    }

    await loadData();
  };

  const reactivateRoomFromUnavailable = async (roomId) => {
    if (!isAdmin) return;

    const room = rooms.find((item) => item.id === roomId);

    if (!room) return;

    const activeUnavailable = (room.unavailability || []).find((period) => {
      if (period.endAt) {
        return false;
      }

      return new Date(period.startAt) <= new Date();
    });

    if (!activeUnavailable) {
      return;
    }

    const confirmed = window.confirm(
      `Vuoi riattivare la sala "${room.name}"?\n\n` +
        `L'indisponibilità verrà terminata in questo momento e rimarrà nello storico.`,
    );

    if (!confirmed) return;

    const reactivatedAt = new Date();

    const { error } = await supabase
      .from("room_unavailability")
      .update({
        end_at: reactivatedAt.toISOString(),
      })
      .eq("id", activeUnavailable.id);

    if (error) {
      console.error("Errore riattivazione sala:", error);

      alert("Impossibile riattivare la sala. Riprova.");

      return;
    }

    await loadData();
  };

  const deleteRoom = async (roomId) => {
    if (!isAdmin) {
      return;
    }

    const room = rooms.find((item) => item.id === roomId);

    if (!room) {
      return;
    }

    const confirmed = window.confirm(
      `Vuoi eliminare definitivamente la sala "${room.name}"?\n\nQuesta operazione non può essere annullata.`,
    );

    if (!confirmed) {
      return;
    }

    const { error } = await supabase.from("rooms").delete().eq("id", roomId);

    if (error) {
      console.error("Errore eliminazione sala:", error);
      alert(`Impossibile eliminare la sala.\n\n${error.message}`);
      return;
    }

    setRooms((currentRooms) =>
      currentRooms.filter((room) => room.id !== roomId),
    );
  };

  /*
   * ============================================================
   * SETTIMANE
   * ============================================================
   */

  const [roomWeeks, setRoomWeeks] = useState({});

  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState("");

  /*
   * ============================================================
   * MODALE NUOVA PRENOTAZIONE
   * ============================================================
   */

  const [showBooking, setShowBooking] = useState(false);

  const [showRoomUnavailable, setShowRoomUnavailable] = useState(false);
  const [unavailableRoomId, setUnavailableRoomId] = useState(null);
  const [unavailableStartDate, setUnavailableStartDate] = useState(null);
  const [unavailableStartTime, setUnavailableStartTime] = useState("08:00");
  const [unavailableEndDate, setUnavailableEndDate] = useState(null);
  const [unavailableEndTime, setUnavailableEndTime] = useState("18:00");
  const [unavailableUntilReactivated, setUnavailableUntilReactivated] =
    useState(false);
  const [unavailableError, setUnavailableError] = useState("");
  const [savingRoomUnavailable, setSavingRoomUnavailable] = useState(false);

  const [selectedRoom, setSelectedRoom] = useState("");

  const [selectedDate, setSelectedDate] = useState(null);

  const [startTime, setStartTime] = useState("");

  const [endTime, setEndTime] = useState("");

  const [bookingReason, setBookingReason] = useState("");

  /*
   * ============================================================
   * DRAG & DROP
   * ============================================================
   */

  const [draggedBooking, setDraggedBooking] = useState(null);

  const [dragOverCell, setDragOverCell] = useState(null);

  /*
   * ============================================================
   * MODIFICA PRENOTAZIONE
   * ============================================================
   */

  const [editingBooking, setEditingBooking] = useState(null);

  const [editReason, setEditReason] = useState("");

  const [editRoomId, setEditRoomId] = useState(null);

  const [editDate, setEditDate] = useState(null);

  const [editStartTime, setEditStartTime] = useState("");

  const [editEndTime, setEditEndTime] = useState("");

  /*
   * ============================================================
   * ERRORI
   * ============================================================
   */

  const [formErrors, setFormErrors] = useState({});

  const [availabilityError, setAvailabilityError] = useState("");

  const [editFormErrors, setEditFormErrors] = useState({});

  /*
   * ============================================================
   * REF
   * ============================================================
   */

  const bookingBlockRefs = useRef({});

  const editTextareaRef = useRef(null);

  const [measuredBookingHeights, setMeasuredBookingHeights] = useState({});

  /*
   * ============================================================
   * CARICAMENTO DATI DA SUPABASE
   * ============================================================
   */

  const loadUsers = async () => {
    if (!isAdmin) {
      setUsers([]);
      return;
    }

    setLoadingUsers(true);
    setUsersError("");

    const { data, error } = await supabase.rpc("get_all_profiles");

    if (error) {
      console.error("Errore caricamento utenti:", error);
      setUsersError("Impossibile caricare gli utenti.");
      setUsers([]);
      setLoadingUsers(false);
      return;
    }

    setUsers(data || []);
    setLoadingUsers(false);
  };

  const changeUserRole = async (userId, newRole) => {
    const { error } = await supabase.rpc("set_user_role", {
      target_user_id: userId,
      new_role: newRole,
    });

    if (error) {
      console.error("Errore modifica ruolo:", error);
      alert("Impossibile modificare il ruolo dell'utente.");
      return;
    }

    // Aggiorna immediatamente la lista senza ricaricare la pagina
    setUsers((currentUsers) =>
      currentUsers.map((user) =>
        user.id === userId ? { ...user, role: newRole } : user,
      ),
    );
  };

  const deleteUserAccount = async (userId) => {
    const userToDelete = users.find((user) => user.id === userId);

    if (!userToDelete) {
      console.error("Utente non trovato:", userId);
      return;
    }

    const confirmed = window.confirm(
      `Sei sicuro di voler eliminare l'utente ${userToDelete.first_name} ${userToDelete.last_name}?\n\nL'account verrà eliminato definitivamente.`,
    );

    if (!confirmed) {
      return;
    }

    const { error } = await supabase.rpc("delete_user_account", {
      target_user_id: userId,
    });

    if (error) {
      console.error("Errore eliminazione utente:", error);
      alert(`Impossibile eliminare l'utente.\n\n${error.message}`);
      return;
    }

    setUsers((currentUsers) =>
      currentUsers.filter((user) => user.id !== userId),
    );
  };

  useEffect(() => {
    if (!session?.user?.id || !isAdmin) {
      setUsers([]);
      return;
    }

    loadUsers();
  }, [session?.user?.id, isAdmin]);

  const loadData = async () => {
    if (!session?.user) {
      return;
    }

    const requestId = ++loadDataRequestRef.current;

    setRoomsError("");

    const { data: roomsData, error: roomsLoadError } = await supabase
      .from("rooms")
      .select("*")
      .order("id", { ascending: true });

    if (roomsLoadError) {
      console.error("Errore caricamento sale:", roomsLoadError);

      setRoomsError("Impossibile caricare le sale dal database.");

      setLoadingRooms(false);

      return;
    }

    const { data: unavailabilityData, error: unavailabilityLoadError } =
      await supabase
        .from("room_unavailability")
        .select("*")
        .order("start_at", { ascending: true });

    if (unavailabilityLoadError) {
      console.error(
        "Errore caricamento indisponibilità:",
        unavailabilityLoadError,
      );

      setRoomsError("Impossibile caricare le indisponibilità delle sale.");

      setLoadingRooms(false);
      return;
    }

    const { data: bookingsData, error: bookingsLoadError } = await supabase
      .from("bookings")
      .select("*")
      .order("booking_date", { ascending: true })
      .order("start_time", { ascending: true });

    if (bookingsLoadError) {
      console.error("Errore caricamento prenotazioni:", bookingsLoadError);

      setRoomsError("Impossibile caricare le prenotazioni dal database.");

      setLoadingRooms(false);

      return;
    }

    const loadedRooms = (roomsData || []).map((room) => {
      const roomBookings = (bookingsData || [])
        .filter((booking) => booking.room_id === room.id)
        .map((booking) => ({
          id: booking.id,
          name: booking.user_name,
          ownerId: booking.user_id,
          day: booking.booking_date,
          start: normalizeTime(booking.start_time),
          end: normalizeTime(booking.end_time),
          reason: booking.reason || "",
        }));

      return {
        id: room.id,
        name: room.name,
        description: room.description || "",
        color: room.color || "#2563eb",
        bookings: roomBookings,

        unavailability: (unavailabilityData || [])
          .filter((item) => item.room_id === room.id)
          .map((item) => ({
            id: item.id,
            startAt: item.start_at,
            endAt: item.end_at,
          })),
      };
    });

    if (requestId !== loadDataRequestRef.current) {
      return;
    }

    setRooms(loadedRooms);

    console.log("ROOMS DATABASE:", roomsData);
    console.log("LOADED ROOMS:", loadedRooms);
    console.log("IS ADMIN:", isAdmin);
    console.log("CURRENT USER:", currentUser);
    console.log("PROFILE:", profile);
    console.log("SESSION USER:", session?.user);

    setRoomWeeks((currentWeeks) => {
      const todayMonday = getMonday(new Date());

      const nextWeeks = {};

      loadedRooms.forEach((room) => {
        nextWeeks[room.id] = currentWeeks[room.id] || new Date(todayMonday);
      });

      return nextWeeks;
    });

    setSelectedRoom((currentSelectedRoom) => {
      if (
        currentSelectedRoom &&
        loadedRooms.some((room) => room.name === currentSelectedRoom)
      ) {
        return currentSelectedRoom;
      }

      return loadedRooms[0]?.name || "";
    });

    setLoadingRooms(false);
  };

  /*
   * Caricamento quando l'utente è autenticato.
   */

  useEffect(() => {
    if (!session?.user) {
      setRooms([]);
      setLoadingRooms(false);
      return;
    }

    if (!profile) {
      setLoadingRooms(true);
      return;
    }

    setLoadingRooms(true);

    loadData();
  }, [session?.user?.id, profile?.id]);

  /*
   * ============================================================
   * REALTIME SUPABASE
   * ============================================================
   */

  useEffect(() => {
    if (!session?.user) {
      return;
    }

    const channel = supabase
      .channel("ilabs-bookings-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bookings",
        },
        () => {
          loadData();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rooms",
        },
        () => {
          loadData();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_unavailability",
        },
        () => {
          loadData();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, profile?.id]);

  /*
   * ============================================================
   * AUTOSIZE MODIFICA
   * ============================================================
   */

  useLayoutEffect(() => {
    if (editingBooking && editTextareaRef.current) {
      autoResizeTextarea(editTextareaRef.current);
    }
  }, [editingBooking]);

  /*
   * ============================================================
   * MISURAZIONE PRENOTAZIONI
   * ============================================================
   */

  useLayoutEffect(() => {
    const nextHeights = {};

    Object.entries(bookingBlockRefs.current).forEach(([bookingId, node]) => {
      if (!node) return;

      const previousMinHeight = node.style.minHeight;

      node.style.minHeight = "auto";

      nextHeights[bookingId] = Math.ceil(node.getBoundingClientRect().height);

      node.style.minHeight = previousMinHeight;
    });

    setMeasuredBookingHeights((current) => {
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(nextHeights);

      const sameKeys =
        currentKeys.length === nextKeys.length &&
        currentKeys.every((key) => nextHeights[key] === current[key]);

      if (sameKeys) {
        return current;
      }

      return nextHeights;
    });
  }, [rooms]);

  /*
   * ============================================================
   * ORARI
   * ============================================================
   */

  const isPastSlot = (date, hour) => {
    const now = new Date();

    const slotEnd = new Date(date);

    slotEnd.setHours(hour + 1, 0, 0, 0);

    return slotEnd <= now;
  };

  const getSlotFillFraction = (date, hour) => {
    const now = new Date();

    const isSameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();

    if (!isSameDay) {
      return 0;
    }

    if (now.getHours() > hour) {
      return 1;
    }

    if (now.getHours() < hour) {
      return 0;
    }

    return now.getMinutes() / 60;
  };

  const getMinStartTimeForSlot = (date, hour) => {
    const now = new Date();

    const isSameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();

    if (!isSameDay || now.getHours() < hour) {
      return `${String(hour).padStart(2, "0")}:00`;
    }

    const minutes = now.getMinutes() + 1;

    if (minutes >= 60) {
      return `${String(hour + 1).padStart(2, "0")}:00`;
    }

    return `${String(hour).padStart(2, "0")}:${String(minutes).padStart(
      2,
      "0",
    )}`;
  };

  /*
   * ============================================================
   * NAVIGAZIONE SETTIMANA
   * ============================================================
   */

  const changeRoomWeek = (roomId, direction) => {
    setRoomWeeks((currentWeeks) => {
      const currentWeek = currentWeeks[roomId] || getMonday(new Date());

      const newWeek = new Date(currentWeek);

      newWeek.setDate(newWeek.getDate() + direction * 7);

      return {
        ...currentWeeks,
        [roomId]: newWeek,
      };
    });
  };

  const goRoomToToday = (roomId) => {
    setRoomWeeks((currentWeeks) => ({
      ...currentWeeks,
      [roomId]: getMonday(new Date()),
    }));
  };

  /*
   * ============================================================
   * APERTURA NUOVA PRENOTAZIONE
   * ============================================================
   */

  const handleCellClick = (roomName, date, hour) => {
    if (!date) {
      return;
    }

    if (isPastSlot(date, hour)) {
      return;
    }

    const room = rooms.find((item) => item.name === roomName);

    if (!room) {
      return;
    }

    const cellStartTime = `${String(hour).padStart(2, "0")}:00`;

    if (isTimeUnavailable(room, date, cellStartTime)) {
      return;
    }

    const clickedDate = new Date(date);
    clickedDate.setHours(0, 0, 0, 0);

    setSelectedRoom(roomName);
    setSelectedDate(clickedDate);
    setStartTime(getMinStartTimeForSlot(date, hour));
    setEndTime(`${String(hour + 1).padStart(2, "0")}:00`);
    setBookingReason("");
    setFormErrors({});
    setAvailabilityError("");
    setShowBooking(true);
  };

  /*
   * ============================================================
   * CONTROLLO OCCUPAZIONE
   * ============================================================
   */

  const isHourOccupied = (room, dateKey, hour, excludeBookingId = null) => {
    const hourStart = hour * 60;
    const hourEnd = (hour + 1) * 60;

    return room.bookings.some((booking) => {
      if (booking.day !== dateKey) {
        return false;
      }

      if (excludeBookingId && booking.id === excludeBookingId) {
        return false;
      }

      const bookingStart = timeToMinutes(booking.start);

      const bookingEnd = timeToMinutes(booking.end);

      return bookingStart < hourEnd && bookingEnd > hourStart;
    });
  };

  /*
   * ============================================================
   * NUOVA PRENOTAZIONE -> SUPABASE INSERT
   * ============================================================
   */

  const handleBooking = async () => {
    if (!currentUser) {
      return;
    }

    setFormErrors({});
    setAvailabilityError("");

    const invalidDay = selectedDate && isWeekend(selectedDate);

    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);

    const invalidTime =
      !startTime ||
      !endTime ||
      startMinutes < 8 * 60 ||
      endMinutes > 18 * 60 ||
      startMinutes >= endMinutes;

    if (invalidDay) {
      setAvailabilityError("Giorno non disponibile");
    } else if (invalidTime) {
      setAvailabilityError("Orario non disponibile");
    }

    const errors = {};

    if (!selectedDate) {
      errors.date = "Campo obbligatorio";
    }

    if (!startTime) {
      errors.startTime = "Campo obbligatorio";
    }

    if (!endTime) {
      errors.endTime = "Campo obbligatorio";
    }

    setFormErrors(errors);

    if (invalidDay || invalidTime || Object.keys(errors).length > 0) {
      return;
    }

    const bookingDate = new Date(selectedDate);

    const [startHour, startMinute] = startTime.split(":").map(Number);

    bookingDate.setHours(startHour, startMinute, 0, 0);

    const now = new Date();

    if (bookingDate <= now) {
      setFormErrors({
        time: "Non puoi effettuare una prenotazione nel passato.",
      });

      return;
    }

    const dateKey = formatDateKey(selectedDate);

    const selectedRoomObject = rooms.find((room) => room.name === selectedRoom);

    if (!selectedRoomObject) {
      setFormErrors({
        room: "Sala non trovata.",
      });

      return;
    }

    /*
     * ============================================================
     * CONTROLLO PRENOTAZIONI GIÀ PRESENTI NELLA PAGINA
     * ============================================================
     */

    const hasConflict = selectedRoomObject.bookings.some((booking) => {
      if (booking.day !== dateKey) {
        return false;
      }

      const bookingStart = timeToMinutes(booking.start);
      const bookingEnd = timeToMinutes(booking.end);

      return startMinutes < bookingEnd && endMinutes > bookingStart;
    });

    if (hasConflict) {
      setFormErrors({
        time: "La sala è già prenotata in questo intervallo di tempo.",
      });

      return;
    }

    /*
     * ============================================================
     * CONTROLLO PRENOTAZIONI DIRETTAMENTE SU SUPABASE
     * ============================================================
     */

    const { data: existingBookings, error: checkError } = await supabase
      .from("bookings")
      .select("id, start_time, end_time")
      .eq("room_id", selectedRoomObject.id)
      .eq("booking_date", dateKey);

    if (checkError) {
      console.error("Errore controllo disponibilità:", checkError);

      setAvailabilityError("Errore durante il controllo della disponibilità.");

      return;
    }

    const databaseConflict = (existingBookings || []).some((booking) => {
      const bookingStart = timeToMinutes(normalizeTime(booking.start_time));

      const bookingEnd = timeToMinutes(normalizeTime(booking.end_time));

      return startMinutes < bookingEnd && endMinutes > bookingStart;
    });

    if (databaseConflict) {
      setFormErrors({
        time: "La sala è già prenotata in questo intervallo di tempo.",
      });

      await loadData();

      return;
    }

    /*
     * ============================================================
     * CONTROLLO INDISPONIBILITÀ DIRETTAMENTE SU SUPABASE
     * ============================================================
     *
     * Questo secondo controllo è importante:
     * se un amministratore imposta un'indisponibilità mentre
     * l'utente ha il popup di prenotazione già aperto,
     * il controllo locale potrebbe non essere aggiornato.
     */

    const { data: currentUnavailability, error: unavailableCheckError } =
      await supabase
        .from("room_unavailability")
        .select("id, start_at, end_at")
        .eq("room_id", selectedRoomObject.id);

    if (unavailableCheckError) {
      console.error("Errore controllo indisponibilità:", unavailableCheckError);

      setAvailabilityError(
        "Errore durante il controllo della disponibilità della sala.",
      );

      return;
    }

    const databaseUnavailableConflict = (currentUnavailability || []).some(
      (period) => {
        const unavailableStart = new Date(period.start_at);

        if (!period.end_at) {
          return newBookingEnd > unavailableStart;
        }

        const unavailableEnd = new Date(period.end_at);

        return (
          newBookingStart < unavailableEnd && newBookingEnd > unavailableStart
        );
      },
    );

    if (databaseUnavailableConflict) {
      setFormErrors({
        time: "La sala non è disponibile nell'intervallo selezionato.",
      });

      await loadData();

      return;
    }

    /*
     * ============================================================
     * INSERIMENTO PRENOTAZIONE
     * ============================================================
     */

    const { error: insertError } = await supabase.from("bookings").insert({
      room_id: selectedRoomObject.id,
      user_id: currentUser.id,
      user_name: currentUser.name,
      booking_date: dateKey,
      start_time: startTime,
      end_time: endTime,
      reason: bookingReason.trim() || null,
    });

    if (insertError) {
      console.error("Errore creazione prenotazione:", insertError);

      setAvailabilityError("Impossibile creare la prenotazione. Riprova.");

      return;
    }

    setShowBooking(false);

    setBookingReason("");
    setFormErrors({});
    setAvailabilityError("");

    setSelectedDate(null);
    setStartTime("08:00");
    setEndTime("09:00");

    await loadData();
  };

  /*
   * ============================================================
   * ELIMINAZIONE -> SUPABASE DELETE
   * ============================================================
   */

  const handleDeleteBooking = async (roomId, bookingId) => {
    const confirmed = window.confirm(
      "Sei sicuro di voler rimuovere questa prenotazione?",
    );

    if (!confirmed) {
      return;
    }

    const room = rooms.find((item) => item.id === roomId);

    const booking = room?.bookings.find((item) => item.id === bookingId);

    if (!booking) {
      return;
    }

    if (!isAdmin && booking.ownerId !== currentUser?.id) {
      return;
    }

    const { error } = await supabase
      .from("bookings")
      .delete()
      .eq("id", bookingId);

    if (error) {
      console.error("Errore eliminazione prenotazione:", error);

      alert("Impossibile eliminare la prenotazione.");

      return;
    }

    delete bookingBlockRefs.current[bookingId];

    setMeasuredBookingHeights((current) => {
      const next = { ...current };

      delete next[bookingId];

      return next;
    });

    await loadData();
  };

  /*
   * ============================================================
   * DRAG START
   * ============================================================
   */

  const handleBookingDragStart = (event, roomId, booking) => {
    if (
      isBookingExpired(booking) ||
      (!isAdmin && booking.ownerId !== currentUser?.id)
    ) {
      event.preventDefault();

      return;
    }

    const payload = {
      roomId,
      bookingId: booking.id,
    };

    event.dataTransfer.effectAllowed = "move";

    event.dataTransfer.setData("application/json", JSON.stringify(payload));

    setDraggedBooking(payload);
  };

  const handleBookingDragEnd = () => {
    setDraggedBooking(null);

    setDragOverCell(null);
  };

  const handleCellDragOver = (event, roomId, date, hour) => {
    if (!draggedBooking || draggedBooking.roomId !== roomId) {
      return;
    }

    event.preventDefault();

    event.dataTransfer.dropEffect = "move";

    setDragOverCell(`${formatDateKey(date)}-${hour}`);
  };

  const handleCellDragLeave = (event, dateKey, hour) => {
    const cellKey = `${dateKey}-${hour}`;

    setDragOverCell((current) => (current === cellKey ? null : current));
  };

  const handleBookingBlockDragOver = (
    event,
    roomId,
    date,
    startHour,
    rowHeights,
  ) => {
    if (!draggedBooking || draggedBooking.roomId !== roomId) {
      return;
    }

    event.preventDefault();

    event.stopPropagation();

    event.dataTransfer.dropEffect = "move";

    const cellNode = event.currentTarget.closest(".calendar-cell");

    const targetHour = cellNode
      ? computeHourFromPointer(
          event.clientY,
          cellNode.getBoundingClientRect().top,
          startHour,
          rowHeights,
        )
      : startHour;

    setDragOverCell(`${formatDateKey(date)}-${targetHour}`);
  };

  const handleBookingBlockDrop = (
    event,
    roomId,
    date,
    startHour,
    rowHeights,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const cellNode = event.currentTarget.closest(".calendar-cell");

    if (!cellNode) {
      return;
    }

    const rowHeight = rowHeights[startHour - 8] || ROW_DEFAULT_HEIGHT;

    const rect = cellNode.getBoundingClientRect();

    /*
     * Calcola il minuto esatto in cui è stato
     * effettuato il drop.
     */
    const targetTime = computeTimeFromPointer(
      event.clientY,
      rect.top,
      startHour,
      rowHeight,
    );

    const targetMinutes = timeToMinutes(targetTime);

    handleCellDrop(event, roomId, date, targetMinutes);
  };

  /*
   * ============================================================
   * DRAG & DROP -> SUPABASE UPDATE
   * ============================================================
   */

  const handleCellDrop = async (event, roomId, date, targetMinutes) => {
    event.preventDefault();
    event.stopPropagation();

    setDragOverCell(null);

    let payload = draggedBooking;

    try {
      const raw = event.dataTransfer.getData("application/json");

      if (raw) {
        payload = JSON.parse(raw);
      }
    } catch {
      // Manteniamo il payload già presente nello state.
    }

    setDraggedBooking(null);

    if (!payload || payload.roomId !== roomId) {
      return;
    }

    const room = rooms.find((item) => item.id === roomId);

    if (!room) {
      return;
    }

    const booking = room.bookings.find((item) => item.id === payload.bookingId);

    if (!booking) {
      return;
    }

    if (
      isBookingExpired(booking) ||
      (!isAdmin && booking.ownerId !== currentUser?.id)
    ) {
      return;
    }

    if (isWeekend(date)) {
      alert("Non è possibile prenotare durante il sabato o la domenica.");

      return;
    }

    /*
     * ============================================================
     * CALCOLO NUOVA POSIZIONE
     * ============================================================
     *
     * targetMinutes arriva direttamente dal punto
     * in cui è stato effettuato il drop.
     *
     * Arrotondiamo ai 5 minuti.
     */

    const originalStartMinutes = timeToMinutes(booking.start);

    /*
     * Manteniamo invariati i minuti originali.
     *
     * Esempio:
     *
     * prenotazione originale: 14:30 - 15:30
     * drop nella cella 13:00
     *
     * nuova prenotazione: 13:30 - 14:30
     */
    const originalMinutes = originalStartMinutes % 60;

    let newStartMinutes = Math.floor(targetMinutes / 60) * 60 + originalMinutes;

    newStartMinutes = Math.max(8 * 60, newStartMinutes);

    /*
     * Se l'inizio dell'ora è occupato, cerca
     * la prima fine di prenotazione disponibile.
     *
     * Esempio:
     *
     * 13:00–13:30 occupato
     * trascino nella cella 13:00
     *
     * -> nuova partenza = 13:30
     */
    const bookingsOnTargetDay = room.bookings
      .filter((item) => {
        return item.day === formatDateKey(date) && item.id !== booking.id;
      })
      .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

    let changedStart = true;

    while (changedStart) {
      changedStart = false;

      const conflictingBooking = bookingsOnTargetDay.find((item) => {
        const bookingStart = timeToMinutes(item.start);
        const bookingEnd = timeToMinutes(item.end);

        return newStartMinutes < bookingEnd && newStartMinutes >= bookingStart;
      });

      if (conflictingBooking) {
        const conflictingEnd = timeToMinutes(conflictingBooking.end);

        /*
         * Porta la prenotazione alla prima ora successiva
         * mantenendo i minuti originali.
         *
         * Esempio:
         * minuti originali = 30
         * conflitto termina 14:00
         * => nuova partenza 14:30
         */
        newStartMinutes =
          Math.floor(conflictingEnd / 60) * 60 + originalMinutes;

        changedStart = true;
      }
    }

    /*
     * ============================================================
     * DURATA PRENOTAZIONE
     * ============================================================
     */
    const originalEndMinutes = timeToMinutes(booking.end);

    const durationMinutes = originalEndMinutes - originalStartMinutes;

    const newEndMinutes = newStartMinutes + durationMinutes;

    /*
     * ============================================================
     * CONTROLLO ORARIO LAVORATIVO
     * ============================================================
     */

    if (newStartMinutes < 8 * 60 || newEndMinutes > 18 * 60) {
      alert(
        "L'orario risultante deve essere compreso tra le 08:00 e le 18:00.",
      );

      return;
    }

    const newDateKey = formatDateKey(date);

    /*
     * ============================================================
     * CONTROLLO DATA PASSATA
     * ============================================================
     */

    const todayKey = formatDateKey(new Date());

    if (newDateKey < todayKey) {
      alert("Non puoi spostare una prenotazione nel passato.");

      return;
    }

    /*
     * Se il booking viene lasciato esattamente
     * nella posizione originale, non facciamo nulla.
     */

    if (
      newDateKey === booking.day &&
      newStartMinutes === originalStartMinutes
    ) {
      return;
    }

    /*
     * ============================================================
     * NUOVO INTERVALLO
     * ============================================================
     */

    const newStartTime = minutesToTime(newStartMinutes);

    const newEndTime = minutesToTime(newEndMinutes);

    const newBookingStart = new Date(date);

    const [newStartHour, newStartMinute] = newStartTime.split(":").map(Number);

    newBookingStart.setHours(newStartHour, newStartMinute, 0, 0);

    const newBookingEnd = new Date(date);

    const [newEndHour, newEndMinute] = newEndTime.split(":").map(Number);

    newBookingEnd.setHours(newEndHour, newEndMinute, 0, 0);

    /*
     * ============================================================
     * CONTROLLO INDISPONIBILITÀ LOCALE
     * ============================================================
     */

    const hasRoomUnavailable = (room.unavailability || []).some((period) => {
      const unavailableStart = new Date(period.startAt);

      /*
       * Indisponibilità indefinita.
       */
      if (!period.endAt) {
        return newBookingEnd > unavailableStart;
      }

      const unavailableEnd = new Date(period.endAt);

      return (
        newBookingStart < unavailableEnd && newBookingEnd > unavailableStart
      );
    });

    if (hasRoomUnavailable) {
      alert("La sala non è disponibile nell'intervallo selezionato.");

      return;
    }

    /*
     * ============================================================
     * CONTROLLO CONFLITTO PRENOTAZIONI PRESENTI IN PAGINA
     * ============================================================
     */

    const hasConflict = room.bookings.some((item) => {
      if (item.id === booking.id) {
        return false;
      }

      if (item.day !== newDateKey) {
        return false;
      }

      const itemStart = timeToMinutes(item.start);

      const itemEnd = timeToMinutes(item.end);

      return newStartMinutes < itemEnd && newEndMinutes > itemStart;
    });

    if (hasConflict) {
      alert("La sala è già prenotata in questo intervallo di tempo.");

      return;
    }

    /*
     * ============================================================
     * CONTROLLO PRENOTAZIONI DIRETTAMENTE SU SUPABASE
     * ============================================================
     */

    const { data: existingBookings, error } = await supabase
      .from("bookings")
      .select("id, start_time, end_time")
      .eq("room_id", roomId)
      .eq("booking_date", newDateKey)
      .neq("id", booking.id);

    if (error) {
      console.error("Errore controllo drag:", error);

      alert("Errore durante il controllo della disponibilità.");

      return;
    }

    const databaseConflict = (existingBookings || []).some((item) => {
      const itemStart = timeToMinutes(normalizeTime(item.start_time));

      const itemEnd = timeToMinutes(normalizeTime(item.end_time));

      return newStartMinutes < itemEnd && newEndMinutes > itemStart;
    });

    if (databaseConflict) {
      alert("La sala è già prenotata in questo intervallo di tempo.");

      await loadData();

      return;
    }

    /*
     * ============================================================
     * CONTROLLO INDISPONIBILITÀ DIRETTAMENTE SU SUPABASE
     * ============================================================
     */

    const { data: currentUnavailability, error: unavailableCheckError } =
      await supabase
        .from("room_unavailability")
        .select("id, start_at, end_at")
        .eq("room_id", roomId);

    if (unavailableCheckError) {
      console.error(
        "Errore controllo indisponibilità drag:",
        unavailableCheckError,
      );

      alert("Errore durante il controllo della disponibilità della sala.");

      return;
    }

    const databaseUnavailableConflict = (currentUnavailability || []).some(
      (period) => {
        const unavailableStart = new Date(period.start_at);

        if (!period.end_at) {
          return newBookingEnd > unavailableStart;
        }

        const unavailableEnd = new Date(period.end_at);

        return (
          newBookingStart < unavailableEnd && newBookingEnd > unavailableStart
        );
      },
    );

    if (databaseUnavailableConflict) {
      alert("La sala non è disponibile nell'intervallo selezionato.");

      await loadData();

      return;
    }

    /*
     * ============================================================
     * AGGIORNAMENTO PRENOTAZIONE
     * ============================================================
     */

    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        booking_date: newDateKey,
        start_time: newStartTime,
        end_time: newEndTime,
      })
      .eq("id", booking.id);

    if (updateError) {
      console.error("Errore spostamento prenotazione:", updateError);

      alert("Impossibile spostare la prenotazione.");

      return;
    }

    await loadData();
  };

  /*
   * ============================================================
   * APERTURA MODIFICA
   * ============================================================
   */

  const openEditReason = (roomId, booking) => {
    if (
      !isAdmin &&
      (booking.ownerId !== currentUser?.id || isBookingExpired(booking))
    ) {
      return;
    }

    setEditingBooking({
      roomId,
      bookingId: booking.id,
    });

    setEditReason(booking.reason || "");

    setEditRoomId(roomId);

    const [year, month, day] = booking.day.split("-").map(Number);

    const bookingDate = new Date(year, month - 1, day);

    setEditDate(bookingDate);

    setEditStartTime(booking.start);

    setEditEndTime(booking.end);

    setEditFormErrors({});
  };

  const closeEditReason = () => {
    setEditingBooking(null);

    setEditReason("");

    setEditRoomId(null);

    setEditDate(null);

    setEditStartTime("");

    setEditEndTime("");

    setEditFormErrors({});
  };

  /*
   * ============================================================
   * MODIFICA -> SUPABASE UPDATE
   * ============================================================
   */

  const handleSaveEditReason = async () => {
    if (!editingBooking) {
      return;
    }

    const sourceRoom = rooms.find((room) => room.id === editingBooking.roomId);

    if (!sourceRoom) {
      return;
    }

    const booking = sourceRoom.bookings.find(
      (item) => item.id === editingBooking.bookingId,
    );

    if (!booking) {
      return;
    }

    if (
      !isAdmin &&
      (booking.ownerId !== currentUser?.id || isBookingExpired(booking))
    ) {
      closeEditReason();

      return;
    }

    if (!editDate || !editStartTime || !editEndTime) {
      alert("Inserisci data, ora di inizio e ora di fine.");

      return;
    }

    if (isWeekend(editDate)) {
      alert("Non è possibile prenotare durante il sabato o la domenica.");

      return;
    }

    const startMinutes = timeToMinutes(editStartTime);
    const endMinutes = timeToMinutes(editEndTime);

    if (
      startMinutes < 8 * 60 ||
      endMinutes > 18 * 60 ||
      startMinutes >= endMinutes
    ) {
      alert("Le prenotazioni devono essere comprese tra le 08:00 e le 18:00.");

      return;
    }

    const targetRoomId = editRoomId ?? editingBooking.roomId;

    const targetRoom = rooms.find((room) => room.id === targetRoomId);

    if (!targetRoom) {
      return;
    }

    const newDateKey = formatDateKey(editDate);

    const now = new Date();

    const newBookingDate = new Date(editDate);

    const [newHour, newMinute] = editStartTime.split(":").map(Number);

    newBookingDate.setHours(newHour, newMinute, 0, 0);

    if (newBookingDate <= now) {
      alert("Non puoi impostare una prenotazione nel passato.");

      return;
    }

    /*
     * ============================================================
     * INTERVALLO DELLA NUOVA PRENOTAZIONE
     * ============================================================
     */

    const requestedStart = new Date(editDate);

    requestedStart.setHours(newHour, newMinute, 0, 0);

    const [newEndHour, newEndMinute] = editEndTime.split(":").map(Number);

    const requestedEnd = new Date(editDate);

    requestedEnd.setHours(newEndHour, newEndMinute, 0, 0);

    /*
     * ============================================================
     * CONTROLLO INDISPONIBILITÀ LOCALE
     * ============================================================
     */

    const hasRoomUnavailable = (targetRoom.unavailability || []).some(
      (period) => {
        const unavailableStart = new Date(period.startAt);

        /*
         * Indisponibilità senza fine:
         * rimane attiva fino alla riattivazione.
         */
        if (!period.endAt) {
          return requestedEnd > unavailableStart;
        }

        const unavailableEnd = new Date(period.endAt);

        /*
         * Controllo sovrapposizione:
         *
         * nuova prenotazione:
         * [requestedStart -------- requestedEnd]
         *
         * indisponibilità:
         * [unavailableStart ---- unavailableEnd]
         */
        return (
          requestedStart < unavailableEnd && requestedEnd > unavailableStart
        );
      },
    );

    if (hasRoomUnavailable) {
      alert("La sala non è disponibile nell'intervallo selezionato.");

      return;
    }

    /*
     * ============================================================
     * CONTROLLO CONFLITTO PRENOTAZIONI PRESENTI IN PAGINA
     * ============================================================
     */

    const hasConflict = targetRoom.bookings.some((item) => {
      if (item.id === editingBooking.bookingId) {
        return false;
      }

      if (item.day !== newDateKey) {
        return false;
      }

      const itemStart = timeToMinutes(item.start);

      const itemEnd = timeToMinutes(item.end);

      return startMinutes < itemEnd && endMinutes > itemStart;
    });

    if (hasConflict) {
      alert("La sala scelta è già prenotata in questo intervallo di tempo.");

      return;
    }

    /*
     * ============================================================
     * CONTROLLO PRENOTAZIONI DIRETTAMENTE SU SUPABASE
     * ============================================================
     */

    const { data: existingBookings, error: checkError } = await supabase
      .from("bookings")
      .select("id, start_time, end_time")
      .eq("room_id", targetRoomId)
      .eq("booking_date", newDateKey)
      .neq("id", editingBooking.bookingId);

    if (checkError) {
      console.error("Errore controllo modifica:", checkError);

      alert("Errore durante il controllo della disponibilità.");

      return;
    }

    const databaseConflict = (existingBookings || []).some((item) => {
      const itemStart = timeToMinutes(normalizeTime(item.start_time));

      const itemEnd = timeToMinutes(normalizeTime(item.end_time));

      return startMinutes < itemEnd && endMinutes > itemStart;
    });

    if (databaseConflict) {
      alert("La sala scelta è già prenotata in questo intervallo di tempo.");

      await loadData();

      return;
    }

    /*
     * ============================================================
     * CONTROLLO INDISPONIBILITÀ DIRETTAMENTE SU SUPABASE
     * ============================================================
     *
     * Serve per gestire il caso in cui un amministratore
     * abbia appena impostato un'indisponibilità mentre
     * l'utente aveva già aperto la modifica della prenotazione.
     */

    const { data: currentUnavailability, error: unavailableCheckError } =
      await supabase
        .from("room_unavailability")
        .select("id, start_at, end_at")
        .eq("room_id", targetRoomId);

    if (unavailableCheckError) {
      console.error(
        "Errore controllo indisponibilità modifica:",
        unavailableCheckError,
      );

      alert("Errore durante il controllo della disponibilità della sala.");

      return;
    }

    const databaseUnavailableConflict = (currentUnavailability || []).some(
      (period) => {
        const unavailableStart = new Date(period.start_at);

        if (!period.end_at) {
          return newBookingEnd > unavailableStart;
        }

        const unavailableEnd = new Date(period.end_at);

        return (
          newBookingStart < unavailableEnd && newBookingEnd > unavailableStart
        );
      },
    );

    if (databaseUnavailableConflict) {
      alert("La sala non è disponibile nell'intervallo selezionato.");

      await loadData();

      return;
    }

    /*
     * ============================================================
     * SALVATAGGIO MODIFICA
     * ============================================================
     */

    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        room_id: targetRoomId,
        booking_date: newDateKey,
        start_time: editStartTime,
        end_time: editEndTime,
        reason: editReason.trim() || null,
      })
      .eq("id", editingBooking.bookingId);

    if (updateError) {
      console.error("Errore modifica prenotazione:", updateError);

      alert("Impossibile modificare la prenotazione.");

      return;
    }

    await loadData();

    closeEditReason();
  };

  /*
   * ============================================================
   * NUOVA PRENOTAZIONE
   * ============================================================
   */

  const openNewBooking = () => {
    setSelectedRoom(rooms[0]?.name || "");

    setSelectedDate(null);

    setStartTime("");

    setEndTime("");

    setBookingReason("");

    setFormErrors({});

    setAvailabilityError("");

    setShowBooking(true);
  };

  /*
   * ============================================================
   * SCHERMATA LOGIN / REGISTRAZIONE
   * ============================================================
   */
  
  if (authLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f6f7f9",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            padding: "30px",
            textAlign: "center",
            color: "#7b8495",
            fontSize: "18px",
            fontWeight: 600,
          }}
        >
          Caricamento...
        </div>
      </div>
    );
  }

  if (session && profile && profile.role === "pending") {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#f6f7f9",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "30px 20px",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "460px",
            background: "#ffffff",
            borderRadius: "18px",
            padding: "38px",
            boxShadow: "0 15px 45px rgba(0, 0, 0, 0.08)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "28px", fontWeight: 800, color: "#111827", marginBottom: "12px" }}>
            I-LABS
          </div>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>⏳</div>
          <h2 style={{ margin: "0 0 12px", fontSize: "20px", color: "#111827" }}>
            Account in attesa di approvazione
          </h2>
          <p style={{ color: "#7b8495", fontSize: "14px", lineHeight: 1.6, margin: "0 0 24px" }}>
            La tua registrazione è stata ricevuta. Un amministratore deve approvare il tuo account prima che tu possa accedere.
          </p>
          <button
            type="button"
            onClick={handleLogout}
            style={{
              padding: "10px 20px",
              border: "1px solid #dfe3e9",
              borderRadius: "8px",
              background: "white",
              color: "#4b5563",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Esci
          </button>
        </div>
      </div>
    );
  }

  if (!session || !currentUser) {
    if (window.__showLogin !== true) {
      return (
        <div
          style={{
            minHeight: "100vh",
            background: "#172033",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "30px 20px",
            fontFamily: "Arial, sans-serif",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "460px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "16px",
            }}
          >
            <div style={{ fontSize: "32px", fontWeight: 900, color: "white", letterSpacing: "-1px", marginBottom: "8px" }}>
              I-LABS
            </div>
            <div style={{ color: "#8f9bad", fontSize: "13px", fontWeight: 700, letterSpacing: "1.5px", marginBottom: "24px" }}>
              PRENOTAZIONE SALE
            </div>
            <button
              type="button"
              onClick={() => { window.__showLogin = true; window.dispatchEvent(new Event("showlogin")); }}
              style={{
                width: "100%",
                padding: "16px",
                border: "none",
                borderRadius: "10px",
                background: "white",
                color: "#172033",
                fontSize: "15px",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Accedi / Registrati
            </button>
            <button
              type="button"
              onClick={() => window.location.href = "/visitatori"}
              style={{
                width: "100%",
                padding: "16px",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "10px",
                background: "transparent",
                color: "white",
                fontSize: "15px",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Visualizza disponibilità sale
            </button>
          </div>
        </div>
      );
    }

            return (
      <div
        style={{
          minHeight: "100vh",
          background: "#f6f7f9",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "30px 20px",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "460px",
            background: "#ffffff",
            borderRadius: "18px",
            padding: "38px",
            boxShadow: "0 15px 45px rgba(0, 0, 0, 0.08)",
          }}
        >
          <button
            type="button"
            onClick={() => { window.__showLogin = false; window.dispatchEvent(new Event("showlogin")); }}
            style={{
              marginBottom: "20px",
              padding: "8px 14px",
              border: "1px solid #dfe3e9",
              borderRadius: "8px",
              background: "white",
              color: "#4b5563",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ← Indietro
          </button>
          <div
            style={{
              fontSize: "28px",
              fontWeight: 800,
              color: "#111827",
              marginBottom: "6px",
            }}
          >
            I-LABS
          </div>

          <div
            style={{
              fontSize: "14px",
              color: "#7b8495",
              marginBottom: "28px",
            }}
          >
            Sistema interno di prenotazione sale
          </div>

          <div
            style={{
              display: "flex",
              gap: "8px",
              marginBottom: "25px",
            }}
          >
            <button
              type="button"
              onClick={() => {
                setAuthMode("login");
                setAuthError("");
                setAuthMessage("");
              }}
              style={{
                flex: 1,
                padding: "11px",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: 700,
                background: authMode === "login" ? "#111827" : "#eef0f3",
                color: authMode === "login" ? "#ffffff" : "#6b7280",
              }}
            >
              Accedi
            </button>

            <button
              type="button"
              onClick={() => {
                setAuthMode("register");
                setAuthError("");
                setAuthMessage("");
              }}
              style={{
                flex: 1,
                padding: "11px",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: 700,
                background: authMode === "register" ? "#111827" : "#eef0f3",
                color: authMode === "register" ? "#ffffff" : "#6b7280",
              }}
            >
              Registrati
            </button>
          </div>

          {authMode === "register" && (
            <>
              <label
                style={{
                  display: "block",
                  marginBottom: "15px",
                  fontSize: "14px",
                  fontWeight: 700,
                  color: "#374151",
                }}
              >
                Nome
                <input
                  type="text"
                  value={authFirstName}
                  onChange={(event) => setAuthFirstName(event.target.value)}
                  placeholder="Mario"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    marginTop: "7px",
                    padding: "12px",
                    border: "1px solid #d1d5db",
                    borderRadius: "8px",
                    fontSize: "15px",
                  }}
                />
              </label>

              <label
                style={{
                  display: "block",
                  marginBottom: "15px",
                  fontSize: "14px",
                  fontWeight: 700,
                  color: "#374151",
                }}
              >
                Cognome
                <input
                  type="text"
                  value={authLastName}
                  onChange={(event) => setAuthLastName(event.target.value)}
                  placeholder="Rossi"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    marginTop: "7px",
                    padding: "12px",
                    border: "1px solid #d1d5db",
                    borderRadius: "8px",
                    fontSize: "15px",
                  }}
                />
              </label>
            </>
          )}

          <label
            style={{
              display: "block",
              marginBottom: "15px",
              fontSize: "14px",
              fontWeight: 700,
              color: "#374151",
            }}
          >
            Email
            <input
              type="email"
              value={authEmail}
              onChange={(event) => setAuthEmail(event.target.value)}
              placeholder="nome@azienda.it"
              autoComplete="email"
              style={{
                width: "100%",
                boxSizing: "border-box",
                marginTop: "7px",
                padding: "12px",
                border: "1px solid #d1d5db",
                borderRadius: "8px",
                fontSize: "15px",
              }}
            />
          </label>

          <label
            style={{
              display: "block",
              marginBottom: "15px",
              fontSize: "14px",
              fontWeight: 700,
              color: "#374151",
            }}
          >
            Password
            <input
              type="password"
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
              placeholder="••••••••"
              autoComplete={
                authMode === "login" ? "current-password" : "new-password"
              }
              style={{
                width: "100%",
                boxSizing: "border-box",
                marginTop: "7px",
                padding: "12px",
                border: "1px solid #d1d5db",
                borderRadius: "8px",
                fontSize: "15px",
              }}
            />
          </label>

          {authMode === "register" && (
            <label
              style={{
                display: "block",
                marginBottom: "15px",
                fontSize: "14px",
                fontWeight: 700,
                color: "#374151",
              }}
            >
              Conferma password
              <input
                type="password"
                value={authConfirmPassword}
                onChange={(event) => setAuthConfirmPassword(event.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  marginTop: "7px",
                  padding: "12px",
                  border: "1px solid #d1d5db",
                  borderRadius: "8px",
                  fontSize: "15px",
                }}
              />
            </label>
          )}

          {authError && (
            <div
              style={{
                marginTop: "12px",
                padding: "12px",
                borderRadius: "8px",
                background: "#fdf3f3",
                color: "#dc2626",
                fontSize: "14px",
                fontWeight: 600,
              }}
            >
              {authError}
            </div>
          )}

          {authMessage && (
            <div
              style={{
                marginTop: "12px",
                padding: "12px",
                borderRadius: "8px",
                background: "#f0fdf4",
                color: "#15803d",
                fontSize: "14px",
                fontWeight: 600,
              }}
            >
              {authMessage}
            </div>
          )}

          <button
            type="button"
            disabled={authSubmitting}
            onClick={authMode === "login" ? handleLogin : handleRegister}
            style={{
              width: "100%",
              marginTop: "22px",
              padding: "14px",
              border: "none",
              borderRadius: "8px",
              background: "#111827",
              color: "#ffffff",
              fontSize: "15px",
              fontWeight: 700,
              cursor: authSubmitting ? "default" : "pointer",
              opacity: authSubmitting ? 0.6 : 1,
            }}
          >
            {authSubmitting
              ? "Attendere..."
              : authMode === "login"
                ? "Accedi"
                : "Crea account"}
          </button>
        </div>
      </div>
    );
  }

  /*
   * ============================================================
   * RENDER
   * ============================================================
   */

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="brand-logo">I-LABS</div>

          <div>
            <h1>Prenotazione Sale</h1>

            <span>Gestione degli spazi aziendali</span>
          </div>
        </div>

        <div className="user">
          <button
            type="button"
            className="user-profile-button"
            onClick={() => setShowProfileMenu((current) => !current)}
          >
            <div className="user-avatar">
              {currentUser.name
                .split(" ")
                .map((part) => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </div>

            <div className="user-info">
              <strong>{currentUser.name}</strong>

              <span>{isAdmin ? "Amministratore" : "Dipendente"}</span>
            </div>
          </button>

          <button
            type="button"
            onClick={handleLogout}
            style={{
              marginLeft: "15px",
              padding: "8px 12px",
              border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: "7px",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Esci
          </button>

          {showProfileMenu && (
            <div className="profile-dropdown">
              <div className="profile-dropdown-header">
                <strong>Il mio profilo</strong>
              </div>

              <div className="profile-dropdown-content">
                <div className="profile-item">
                  <span>Nome</span>
                  <strong>{profile?.first_name || "-"}</strong>
                </div>

                <div className="profile-item">
                  <span>Cognome</span>
                  <strong>{profile?.last_name || "-"}</strong>
                </div>

                <div className="profile-item">
                  <span>Email</span>
                  <strong>{session?.user?.email || "-"}</strong>
                </div>

                <div className="profile-item">
                  <span>Ruolo</span>
                  <strong>{isAdmin ? "Amministratore" : "Dipendente"}</strong>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="main">
        <section className="hero">
          <div>
            <span className="eyebrow">GESTIONE SALE</span>

            <h2>
              Prenota uno spazio
              <br />
              per il tuo prossimo incontro.
            </h2>

            <p>
              Scegli la stanza, la data e l'orario che preferisci. Le
              disponibilità vengono controllate automaticamente.
            </p>
          </div>

          <button
            type="button"
            className="book-button"
            onClick={openNewBooking}
            disabled={loadingRooms || rooms.length === 0}
          >
            <span className="plus">+</span>
            PRENOTA
          </button>
        </section>

        <section className="rooms-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">DISPONIBILITÀ</span>

              <h3>Prenotazioni delle sale</h3>
            </div>

            {showAddRoomModal && (
              <div className="modal-overlay">
                <div className="modal">
                  <div className="modal-header">
                    <div>
                      <span className="eyebrow">AMMINISTRAZIONE</span>
                      <h3>Aggiungi sala</h3>
                    </div>

                    <button
                      type="button"
                      className="modal-close"
                      onClick={() => setShowAddRoomModal(false)}
                    >
                      ×
                    </button>
                  </div>

                  <div className="modal-body">
                    <label>
                      Nome della sala
                      <input
                        type="text"
                        value={newRoomName}
                        onChange={(event) => setNewRoomName(event.target.value)}
                        placeholder="Es. Sala Riunioni"
                      />
                    </label>

                    <label>
                      Descrizione
                      <textarea
                        value={newRoomDescription}
                        onChange={(event) =>
                          setNewRoomDescription(event.target.value)
                        }
                        placeholder="Descrizione della sala"
                        rows={4}
                      />
                    </label>

                    <label>
                      Colore
                      <input
                        type="color"
                        value={newRoomColor}
                        onChange={(event) =>
                          setNewRoomColor(event.target.value)
                        }
                      />
                    </label>
                  </div>

                  <div className="modal-footer">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setShowAddRoomModal(false)}
                      disabled={addingRoom}
                    >
                      Annulla
                    </button>

                    <button
                      type="button"
                      className="primary-button"
                      onClick={addRoom}
                      disabled={addingRoom}
                    >
                      {addingRoom ? "Aggiunta..." : "Aggiungi sala"}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {showEditRoomModal && editingRoom && (
              <div className="modal-overlay">
                <div className="modal">
                  <div className="modal-header">
                    <div>
                      <span className="eyebrow">AMMINISTRAZIONE</span>
                      <h3>Modifica sala</h3>
                    </div>

                    <button
                      type="button"
                      className="modal-close"
                      onClick={() => setShowEditRoomModal(false)}
                    >
                      ×
                    </button>
                  </div>

                  <div className="modal-body">
                    <label>
                      Nome della sala
                      <input
                        type="text"
                        value={editRoomName}
                        onChange={(event) =>
                          setEditRoomName(event.target.value)
                        }
                        placeholder="Nome della sala"
                      />
                    </label>

                    <label>
                      Descrizione
                      <textarea
                        value={editRoomDescription}
                        onChange={(event) =>
                          setEditRoomDescription(event.target.value)
                        }
                        placeholder="Descrizione della sala"
                        rows={4}
                      />
                    </label>

                    <label>
                      Colore
                      <input
                        type="color"
                        value={editRoomColor}
                        onChange={(event) =>
                          setEditRoomColor(event.target.value)
                        }
                      />
                    </label>
                  </div>

                  <div className="modal-footer">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setShowEditRoomModal(false)}
                      disabled={savingRoom}
                    >
                      Annulla
                    </button>

                    <button
                      type="button"
                      className="primary-button"
                      onClick={updateRoom}
                      disabled={savingRoom}
                    >
                      {savingRoom ? "Salvataggio..." : "Salva modifiche"}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {isAdmin && (
              <div className="room-admin-actions room-admin-actions-add">
                <button
                  type="button"
                  onClick={() => setShowAddRoomModal(true)}
                  className="room-admin-button"
                >
                  + Aggiungi sala
                </button>
              </div>
            )}
          </div>

          {!loadingRooms && roomsError && (
            <div
              style={{
                padding: "20px",
                borderRadius: "8px",
                background: "#fdf3f3",
                color: "#dc2626",
                fontWeight: 700,
              }}
            >
              {roomsError}
            </div>
          )}

          {!loadingRooms && !roomsError && rooms.length === 0 && (
            <div
              style={{
                padding: "30px",
                textAlign: "center",
                color: "#7b8495",
              }}
            >
              Nessuna sala configurata nel database.
            </div>
          )}

          <div className="rooms-calendar">
            {rooms.map((room) => {
              const currentWeekStart =
                roomWeeks[room.id] || getMonday(new Date());

              const weekDays = Array.from({ length: 5 }, (_, index) => {
                const date = new Date(currentWeekStart);

                date.setDate(currentWeekStart.getDate() + index);

                return date;
              });

              const isCurrentWeek =
                currentWeekStart.getTime() === getMonday(new Date()).getTime();

              const weekTitle = `${weekDays[0].toLocaleDateString("it-IT", {
                day: "numeric",
                month: "long",
              })} – ${weekDays[4].toLocaleDateString("it-IT", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}`;

              const rowHeights = Array.from({ length: 10 }, (_, index) => {
                const hour = index + 8;

                let neededHeight = ROW_DEFAULT_HEIGHT;

                const rowHeights = Array.from({ length: 10 }, (_, index) => {
                  const hour = index + 8;

                  let neededHeight = ROW_DEFAULT_HEIGHT;

                  weekDays.forEach((date) => {
                    const dateKey = formatDateKey(date);

                    const bookingsInCell = room.bookings.filter((item) => {
                      if (item.day !== dateKey) {
                        return false;
                      }

                      const start = timeToMinutes(item.start);

                      return start >= hour * 60 && start < (hour + 1) * 60;
                    });

                    bookingsInCell.forEach((booking) => {
                      const duration =
                        timeToMinutes(booking.end) -
                        timeToMinutes(booking.start);

                      if (duration > 60) {
                        return;
                      }

                      const measured = measuredBookingHeights[booking.id];

                      const contentHeight = measured
                        ? measured + 8
                        : estimateBookingContentHeight(booking) + 8;

                      const startMinutes = timeToMinutes(booking.start);

                      const minutesIntoHour = startMinutes % 60;

                      const offset =
                        (minutesIntoHour / 60) * ROW_DEFAULT_HEIGHT;

                      const requiredHeight = offset + contentHeight;

                      if (requiredHeight > neededHeight) {
                        neededHeight = requiredHeight;
                      }
                    });
                  });

                  return neededHeight;
                });

                return neededHeight;
              });

              return (
                <div className="calendar-room" key={room.id}>
                  <div className="calendar-room-header">
                    <div className="calendar-room-name">
                      <span
                        className="calendar-room-color"
                        style={{
                          backgroundColor: room.color,
                        }}
                      />

                      <div>
                        <h4>{room.name}</h4>

                        <p>{room.description}</p>
                      </div>
                    </div>
                    {isAdmin && (
                      <>
                        <div className="room-admin-actions">
                          <button
                            type="button"
                            className="room-admin-button room-admin-edit"
                            onClick={() => {
                              setEditingRoom(room);
                              setEditRoomName(room.name || "");
                              setEditRoomDescription(room.description || "");
                              setEditRoomColor(room.color || "#2563eb");
                              setShowEditRoomModal(true);
                            }}
                          >
                            Modifica
                          </button>
                        </div>

                        <div className="room-admin-actions">
                          {(() => {
                            const activeUnavailable = (
                              room.unavailability || []
                            ).find(
                              (period) =>
                                !period.endAt &&
                                new Date(period.startAt) <= new Date(),
                            );

                            if (activeUnavailable) {
                              return (
                                <button
                                  type="button"
                                  className="room-admin-button room-admin-deactivate"
                                  onClick={() =>
                                    reactivateRoomFromUnavailable(room.id)
                                  }
                                >
                                  Riattiva
                                </button>
                              );
                            }

                            return (
                              <button
                                type="button"
                                className="room-admin-button room-admin-deactivate"
                                onClick={() =>
                                  openRoomUnavailableModal(room.id)
                                }
                              >
                                Imposta indisponibilità
                              </button>
                            );
                          })()}
                        </div>

                        <div className="room-admin-actions">
                          <button
                            type="button"
                            className="room-admin-button room-admin-delete"
                            onClick={() => deleteRoom(room.id)}
                          >
                            Elimina
                          </button>
                        </div>
                      </>
                    )}
                    <div className="room-calendar-navigation">
                      <button
                        type="button"
                        className="week-button"
                        onClick={() => changeRoomWeek(room.id, -1)}
                      >
                        ←
                      </button>

                      <button
                        type="button"
                        className="today-button"
                        onClick={() => goRoomToToday(room.id)}
                      >
                        Oggi
                      </button>

                      <span className="week-title">{weekTitle}</span>

                      <button
                        type="button"
                        className="week-button"
                        onClick={() => changeRoomWeek(room.id, 1)}
                      >
                        →
                      </button>
                    </div>
                  </div>

                  <div className="calendar-wrapper">
                    <div className="calendar-header-row">
                      <div className="time-column-header" />

                      {weekDays.map((date, index) => {
                        const dateKey = formatDateKey(date);

                        const todayKey = formatDateKey(new Date());

                        const isToday = dateKey === todayKey;

                        return (
                          <div
                            className={`day-column-header ${
                              isToday ? "today-column" : ""
                            }`}
                            key={dateKey}
                          >
                            <span>{dayNames[index]}</span>

                            <strong>{date.getDate()}</strong>
                          </div>
                        );
                      })}
                    </div>

                    {Array.from({ length: 10 }, (_, index) => {
                      const hour = index + 8;

                      const rowHeight = rowHeights[index];

                      return (
                        <div
                          className="calendar-row"
                          key={hour}
                          style={{
                            height: `${rowHeight}px`,
                          }}
                        >
                          <div className="time-cell">
                            {String(hour).padStart(2, "0")}:00
                          </div>

                          {weekDays.map((date) => {
                            const dateKey = formatDateKey(date);

                            const occupied = isHourOccupied(
                              room,
                              dateKey,
                              hour,
                            );

                            const past = isPastSlot(date, hour);

                            const fillFraction = past
                              ? 1
                              : getSlotFillFraction(date, hour);

                            /*
                             * ============================================================
                             * INDISPONIBILITÀ SALA
                             * ============================================================
                             *
                             * Calcoliamo esattamente quale parte dell'ora è coperta
                             * dall'indisponibilità.
                             *
                             * Esempio:
                             *
                             * 14:30 -> 16:30
                             *
                             * 14:00-15:00 = 50%
                             * 15:00-16:00 = 100%
                             * 16:00-17:00 = 50%
                             *
                             * Inoltre la parte già trascorsa dell'ora corrente
                             * non viene colorata di giallo.
                             */

                            const cellStart = new Date(date);
                            cellStart.setHours(hour, 0, 0, 0);

                            const cellEnd = new Date(date);
                            cellEnd.setHours(hour + 1, 0, 0, 0);

                            const now = new Date();

                            let unavailableTop = 0;
                            let unavailableHeight = 0;

                            if (
                              !past &&
                              room.unavailability &&
                              room.unavailability.length > 0
                            ) {
                              const unavailableParts = [];

                              room.unavailability.forEach((period) => {
                                const unavailableStart = new Date(
                                  period.startAt,
                                );

                                const unavailableEnd = period.endAt
                                  ? new Date(period.endAt)
                                  : null;

                                /*
                                 * L'indisponibilità deve essere visibile solo
                                 * dalla parte non ancora trascorsa.
                                 */
                                const visibleStart = new Date(
                                  Math.max(
                                    cellStart.getTime(),
                                    unavailableStart.getTime(),
                                    now.getTime(),
                                  ),
                                );

                                const visibleEnd = new Date(
                                  Math.min(
                                    cellEnd.getTime(),
                                    unavailableEnd
                                      ? unavailableEnd.getTime()
                                      : cellEnd.getTime(),
                                  ),
                                );

                                if (visibleEnd > visibleStart) {
                                  unavailableParts.push({
                                    start: visibleStart,
                                    end: visibleEnd,
                                  });
                                }
                              });

                              if (unavailableParts.length > 0) {
                                /*
                                 * Uniamo eventuali periodi sovrapposti,
                                 * evitando di colorare due volte la stessa zona.
                                 */
                                unavailableParts.sort(
                                  (a, b) => a.start - b.start,
                                );

                                const mergedParts = [];

                                unavailableParts.forEach((part) => {
                                  const last =
                                    mergedParts[mergedParts.length - 1];

                                  if (
                                    last &&
                                    part.start.getTime() <= last.end.getTime()
                                  ) {
                                    if (
                                      part.end.getTime() > last.end.getTime()
                                    ) {
                                      last.end = part.end;
                                    }
                                  } else {
                                    mergedParts.push({
                                      start: new Date(part.start),
                                      end: new Date(part.end),
                                    });
                                  }
                                });

                                const totalUnavailableMilliseconds =
                                  mergedParts.reduce(
                                    (total, part) =>
                                      total +
                                      (part.end.getTime() -
                                        part.start.getTime()),
                                    0,
                                  );

                                const totalCellMilliseconds =
                                  cellEnd.getTime() - cellStart.getTime();

                                unavailableHeight = Math.min(
                                  100,
                                  (totalUnavailableMilliseconds /
                                    totalCellMilliseconds) *
                                    100,
                                );

                                /*
                                 * Posizione verticale del giallo.
                                 *
                                 * Se l'indisponibilità inizia alle 14:30,
                                 * il giallo parte dal 50% della cella.
                                 */
                                const firstPart = mergedParts[0];

                                unavailableTop =
                                  ((firstPart.start.getTime() -
                                    cellStart.getTime()) /
                                    totalCellMilliseconds) *
                                  100;
                              }
                            }

                            const hasUnavailable = unavailableHeight > 0;

                            const bookingsInCell = room.bookings.filter(
                              (item) => {
                                if (item.day !== dateKey) {
                                  return false;
                                }

                                const start = timeToMinutes(item.start);

                                return (
                                  start >= hour * 60 && start < (hour + 1) * 60
                                );
                              },
                            );

                            const isToday =
                              dateKey === formatDateKey(new Date());

                            const cellKey = `${dateKey}-${hour}`;

                            /*
                             * Una cella non può essere un target valido
                             * se contiene un'indisponibilità.
                             */
                            const isDropTarget =
                              draggedBooking &&
                              draggedBooking.roomId === room.id &&
                              !isHourOccupied(
                                room,
                                dateKey,
                                hour,
                                draggedBooking.bookingId,
                              ) &&
                              !past;

                            const isDragHover = dragOverCell === cellKey;

                            return (
                              <div
                                className={`calendar-cell ${
                                  occupied ? "occupied" : ""
                                } ${past ? "past" : ""} ${
                                  isToday ? "today-cell" : ""
                                } ${
                                  draggedBooking
                                    ? isDropTarget
                                      ? "drop-valid"
                                      : "drop-invalid"
                                    : ""
                                } ${
                                  isDragHover ? "drop-hover" : ""
                                } ${hasUnavailable ? "unavailable-cell" : ""}`}
                                key={cellKey}
                                onClick={(event) => {
                                  if (past || draggedBooking) {
                                    return;
                                  }

                                  const dateKey = formatDateKey(date);

                                  /*
                                   * Inizio dell'ora cliccata.
                                   *
                                   * Esempio:
                                   * cella 13:00 -> 13:00
                                   */
                                  const hourStartMinutes = hour * 60;

                                  /*
                                   * Trova una prenotazione che occupa l'inizio
                                   * dell'ora corrente.
                                   */
                                  const bookingAtHourStart = room.bookings
                                    .filter((item) => item.day === dateKey)
                                    .find((item) => {
                                      const start = timeToMinutes(item.start);
                                      const end = timeToMinutes(item.end);

                                      return (
                                        start <= hourStartMinutes &&
                                        end > hourStartMinutes
                                      );
                                    });

                                  let clickedMinutes = hourStartMinutes;

                                  /*
                                   * Se l'ora è occupata proprio all'inizio,
                                   * parti dalla fine della prenotazione.
                                   *
                                   * Esempio:
                                   * 13:00–13:30
                                   * -> clic sulla cella = 13:30
                                   */
                                  if (bookingAtHourStart) {
                                    clickedMinutes = timeToMinutes(
                                      bookingAtHourStart.end,
                                    );
                                  }

                                  /*
                                   * Se la cella cliccata corrisponde all'ora
                                   * corrente, non permettere un orario di
                                   * inizio già passato (parte grigia).
                                   *
                                   * Esempio:
                                   * sono le 15:01, clic sulla cella 15:00
                                   * -> inizio predefinito = 15:02
                                   */
                                  const nowClick = new Date();

                                  const isCurrentHourToday =
                                    date.getFullYear() ===
                                      nowClick.getFullYear() &&
                                    date.getMonth() === nowClick.getMonth() &&
                                    date.getDate() === nowClick.getDate() &&
                                    hour === nowClick.getHours();

                                  if (isCurrentHourToday) {
                                    const minClickMinutes =
                                      hour * 60 + nowClick.getMinutes() + 1;

                                    if (minClickMinutes > clickedMinutes) {
                                      clickedMinutes = minClickMinutes;
                                    }
                                  }

                                  /*
                                   * Se c'è una prenotazione che inizia più avanti
                                   * nella stessa ora, la fine predefinita sarà
                                   * l'inizio di quella prenotazione.
                                   *
                                   * Esempio:
                                   * prenotazione 13:30–14:30
                                   * -> clic sulla cella = 13:00–13:30
                                   */
                                  const nextBooking = room.bookings
                                    .filter((item) => {
                                      if (item.day !== dateKey) {
                                        return false;
                                      }

                                      const bookingStart = timeToMinutes(
                                        item.start,
                                      );

                                      return (
                                        bookingStart > clickedMinutes &&
                                        bookingStart < (hour + 1) * 60
                                      );
                                    })
                                    .sort(
                                      (a, b) =>
                                        timeToMinutes(a.start) -
                                        timeToMinutes(b.start),
                                    )[0];

                                  /*
                                   * Se il punto individuato è dentro una prenotazione,
                                   * non apriamo il modal.
                                   */
                                  const clickedBooking = room.bookings.find(
                                    (item) => {
                                      if (item.day !== dateKey) {
                                        return false;
                                      }

                                      const bookingStart = timeToMinutes(
                                        item.start,
                                      );
                                      const bookingEnd = timeToMinutes(
                                        item.end,
                                      );

                                      return (
                                        clickedMinutes >= bookingStart &&
                                        clickedMinutes < bookingEnd
                                      );
                                    },
                                  );

                                  if (clickedBooking) {
                                    return;
                                  }

                                  /*
                                   * Controllo indisponibilità.
                                   */
                                  const clickedTime =
                                    minutesToTime(clickedMinutes);

                                  if (
                                    isTimeUnavailable(room, date, clickedTime)
                                  ) {
                                    return;
                                  }

                                  const clickedDate = new Date(date);
                                  clickedDate.setHours(0, 0, 0, 0);

                                  setSelectedRoom(room.name);
                                  setSelectedDate(clickedDate);

                                  setStartTime(clickedTime);

                                  const defaultEndMinutes = nextBooking
                                    ? timeToMinutes(nextBooking.start)
                                    : Math.min(
                                        clickedMinutes + 60,
                                        (hour + 1) * 60,
                                      );

                                  setEndTime(minutesToTime(defaultEndMinutes));

                                  setBookingReason("");
                                  setFormErrors({});
                                  setAvailabilityError("");
                                  setShowBooking(true);
                                }}
                                onDragOver={(event) => {
                                  if (!draggedBooking) {
                                    return;
                                  }

                                  event.preventDefault();

                                  const cell = event.currentTarget;

                                  const targetRoom = rooms.find(
                                    (item) => item.id === room.id,
                                  );

                                  if (!targetRoom) {
                                    return;
                                  }

                                  const dragged = targetRoom.bookings.find(
                                    (booking) =>
                                      booking.id === draggedBooking.bookingId,
                                  );

                                  if (!dragged) {
                                    return;
                                  }

                                  const duration =
                                    timeToMinutes(dragged.end) -
                                    timeToMinutes(dragged.start);

                                  /*
                                   * Manteniamo i minuti originali della prenotazione.
                                   *
                                   * Esempio:
                                   * 14:30 -> trascinata nella cella 13:00
                                   * diventa 13:30.
                                   */
                                  const originalMinutes =
                                    timeToMinutes(dragged.start) % 60;

                                  const targetMinutes =
                                    hour * 60 + originalMinutes;

                                  const targetEndMinutes =
                                    targetMinutes + duration;

                                  if (targetEndMinutes > 18 * 60) {
                                    setDragOverCell(null);
                                    return;
                                  }

                                  const targetStartTime =
                                    minutesToTime(targetMinutes);

                                  const targetEndTime =
                                    minutesToTime(targetEndMinutes);

                                  const unavailable =
                                    isBookingIntervalUnavailable(
                                      targetRoom,
                                      date,
                                      targetStartTime,
                                      targetEndTime,
                                    );

                                  if (unavailable) {
                                    setDragOverCell(null);
                                    return;
                                  }

                                  setDragOverCell(`${dateKey}-${hour}`);
                                }}
                                onDrop={(event) => {
                                  const dragged = room.bookings.find(
                                    (booking) =>
                                      booking.id === draggedBooking?.bookingId,
                                  );

                                  if (!dragged) {
                                    return;
                                  }

                                  /*
                                   * Mantieni invariati i minuti della prenotazione
                                   * e modifica esclusivamente l'ora.
                                   *
                                   * 14:30 -> cella 13:00 = 13:30
                                   */
                                  const originalMinutes =
                                    timeToMinutes(dragged.start) % 60;

                                  const targetMinutes =
                                    hour * 60 + originalMinutes;

                                  handleCellDrop(
                                    event,
                                    room.id,
                                    date,
                                    targetMinutes,
                                  );
                                }}
                              >
                                {!past && fillFraction > 0 && (
                                  <div
                                    className="calendar-cell-fill"
                                    style={{
                                      height: `${fillFraction * 100}%`,
                                    }}
                                  />
                                )}

                                {hasUnavailable && (
                                  <div
                                    className="calendar-cell-unavailable"
                                    style={{
                                      top: `${unavailableTop}%`,
                                      height: `${unavailableHeight}%`,
                                    }}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                    }}
                                    onDragOver={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                    }}
                                    onDrop={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                    }}
                                  />
                                )}

                                {bookingsInCell.map((booking) => (
                                  <div
                                    key={booking.id}
                                    ref={(node) => {
                                      bookingBlockRefs.current[booking.id] =
                                        node;
                                    }}
                                    className={`booking-block ${
                                      booking.ownerId === currentUser.id
                                        ? "booking-block-owned"
                                        : ""
                                    } ${
                                      isBookingActive(booking)
                                        ? "booking-block-active"
                                        : ""
                                    } ${
                                      isBookingExpired(booking)
                                        ? "booking-block-expired"
                                        : ""
                                    } ${
                                      draggedBooking &&
                                      draggedBooking.bookingId === booking.id
                                        ? "booking-block-dragging"
                                        : ""
                                    }`}
                                    style={{
                                      backgroundColor: isBookingExpired(booking)
                                        ? undefined
                                        : isBookingActive(booking)
                                          ? "#16a34a"
                                          : "#2563eb",
                                      minHeight: `${computeBookingBlockHeight(
                                        booking,
                                        rowHeights,
                                      )}px`,
                                      marginTop: `${computeBookingBlockOffset(
                                        booking,
                                        rowHeights,
                                      )}px`,
                                    }}
                                    draggable={
                                      !isBookingExpired(booking) &&
                                      (isAdmin ||
                                        booking.ownerId === currentUser.id)
                                    }
                                    onDragStart={(event) =>
                                      handleBookingDragStart(
                                        event,
                                        room.id,
                                        booking,
                                      )
                                    }
                                    onDragEnd={handleBookingDragEnd}
                                    onDragOver={(event) =>
                                      handleBookingBlockDragOver(
                                        event,
                                        room.id,
                                        date,
                                        hour,
                                        rowHeights,
                                      )
                                    }
                                    onDrop={(event) =>
                                      handleBookingBlockDrop(
                                        event,
                                        room.id,
                                        date,
                                        hour,
                                        rowHeights,
                                      )
                                    }
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <div className="booking-top-row">
                                      <strong>{booking.name}</strong>

                                      {(isAdmin ||
                                        (!isBookingExpired(booking) &&
                                          booking.ownerId ===
                                            currentUser.id)) && (
                                        <div className="booking-owner-actions">
                                          <button
                                            type="button"
                                            className="calendar-edit-button"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              openEditReason(room.id, booking);
                                            }}
                                          >
                                            Modifica
                                          </button>

                                          <button
                                            type="button"
                                            className="calendar-delete-button"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              handleDeleteBooking(
                                                room.id,
                                                booking.id,
                                              );
                                            }}
                                          >
                                            ×
                                          </button>
                                        </div>
                                      )}
                                    </div>

                                    <span className="booking-time">
                                      {booking.start} – {booking.end}
                                    </span>

                                    {booking.reason && (
                                      <span className="booking-reason">
                                        {booking.reason}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {isAdmin && (
          <section className="admin-section">
            <div className="admin-section-header">
              <div>
                <span className="eyebrow">AMMINISTRAZIONE</span>
                <h2>Indisponibilità sale</h2>
                <p>
                  Visualizza e gestisci gli intervalli di indisponibilità delle
                  sale.
                </p>
              </div>
            </div>

            <div className="room-unavailability-list">
              {rooms.every(
                (room) =>
                  !room.unavailability || room.unavailability.length === 0,
              ) ? (
                <div className="admin-empty-state">
                  Nessuna indisponibilità presente.
                </div>
              ) : (
                rooms.map((room) => {
                  if (
                    !room.unavailability ||
                    room.unavailability.length === 0
                  ) {
                    return null;
                  }

                  return (
                    <div key={room.id} className="room-unavailability-group">
                      <div className="room-unavailability-room">
                        <strong>{room.name}</strong>
                      </div>

                      <div className="room-unavailability-items">
                        {room.unavailability.map((period) => {
                          const startAt = new Date(period.startAt);

                          const endAt = period.endAt
                            ? new Date(period.endAt)
                            : null;

                          const now = new Date();

                          let status = "Terminata";
                          let statusClass = "unavailability-status-ended";

                          if (startAt > now) {
                            status = "Programmata";
                            statusClass = "unavailability-status-planned";
                          } else if (!endAt || endAt > now) {
                            status = "Attiva";
                            statusClass = "unavailability-status-active";
                          }

                          const formatDateTime = (date) => {
                            return `${date.toLocaleDateString(
                              "it-IT",
                            )} ${date.toLocaleTimeString("it-IT", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}`;
                          };

                          return (
                            <div
                              key={period.id}
                              className="room-unavailability-item"
                            >
                              <div className="room-unavailability-info">
                                <div className="room-unavailability-dates">
                                  <span>
                                    <strong>Inizio:</strong>{" "}
                                    {formatDateTime(startAt)}
                                  </span>

                                  <span>
                                    <strong>Fine:</strong>{" "}
                                    {endAt
                                      ? formatDateTime(endAt)
                                      : "Fino a riattivazione"}
                                  </span>
                                </div>

                                <span
                                  className={`unavailability-status ${statusClass}`}
                                >
                                  {status}
                                </span>
                              </div>

                              <button
                                type="button"
                                className="room-unavailability-delete"
                                onClick={() => deleteRoomUnavailable(period.id)}
                              >
                                Rimuovi
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        )}

        {isAdmin && (
          <section className="rooms-section" style={{ marginBottom: "40px" }}>
            <div className="section-heading">
              <div>
                <span className="eyebrow">AMMINISTRAZIONE</span>
                <h3>Gestione nuovi account</h3>
              </div>
            </div>

            {users.filter((u) => u.role === "pending").length === 0 ? (
              <div style={{ padding: "20px", color: "#7b8495", textAlign: "center" }}>
                Nessun account in attesa di approvazione.
              </div>
            ) : (
              <div>
                {users
                  .filter((u) => u.role === "pending")
                  .map((user) => (
                    <div
                      key={user.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "20px",
                        padding: "14px 0",
                        borderBottom: "1px solid #e5e7eb",
                      }}
                    >
                      <div>
                        <strong>{user.first_name} {user.last_name}</strong>
                        <div style={{ marginTop: "4px", color: "#666" }}>{user.email}</div>
                      </div>

                      <div style={{ display: "flex", gap: "10px" }}>
                        <button
                          type="button"
                          onClick={() => changeUserRole(user.id, "user")}
                          style={{
                            padding: "7px 14px",
                            border: "none",
                            borderRadius: "6px",
                            background: "#16a34a",
                            color: "white",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          Approva
                        </button>

                        <button
                          type="button"
                          onClick={() => deleteUserAccount(user.id)}
                          style={{
                            padding: "7px 14px",
                            border: "1px solid #dc2626",
                            borderRadius: "6px",
                            background: "white",
                            color: "#dc2626",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          Rifiuta
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </section>
        )}
        
        {isAdmin && (
          <section className="rooms-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">AMMINISTRAZIONE</span>

                <h3>Gestione utenti</h3>
              </div>
            </div>

            {loadingUsers ? (
              <p>Caricamento utenti...</p>
            ) : usersError ? (
              <p>{usersError}</p>
            ) : users.length === 0 ? (
              <p>Nessun utente trovato.</p>
            ) : (
              <div>
                              {users.filter((u) => u.role !== "pending").map((user) => (
                  <div
                    key={user.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "20px",
                      padding: "14px 0",
                      borderBottom: "1px solid #e5e7eb",
                    }}
                  >
                    <div>
                      <strong>
                        {user.first_name} {user.last_name}
                      </strong>

                      <div
                        style={{
                          marginTop: "4px",
                          color: "#666",
                        }}
                      >
                        {user.email}
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                      }}
                    >
                      <select
                        value={user.role}
                        disabled={user.id === currentUser.id}
                        onChange={(event) =>
                          changeUserRole(user.id, event.target.value)
                        }
                        className="admin-role-select"
                      >
                        <option value="user">Utente</option>
                        <option value="admin">Amministratore</option>
                      </select>

                      {user.id === currentUser.id ? (
                        <span
                          style={{
                            fontSize: "13px",
                            color: "#777",
                          }}
                        >
                          Tu
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            console.log("CLICK ELIMINA");
                            console.log("ID UTENTE:", user.id);
                            deleteUserAccount(user.id);
                          }}
                          style={{
                            padding: "7px 12px",
                            border: "1px solid #dc2626",
                            borderRadius: "6px",
                            background: "#fff",
                            color: "#dc2626",
                            cursor: "pointer",
                            fontWeight: "600",
                          }}
                        >
                          Elimina
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="footer">
        <span>© 2026 I-LABS</span>

        <span>Sistema interno di prenotazione</span>
      </footer>

      {showRoomUnavailable && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (!savingRoomUnavailable) {
              setShowRoomUnavailable(false);
            }
          }}
        >
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="eyebrow">AMMINISTRAZIONE</span>

                <h3>Imposta indisponibilità</h3>
              </div>

              <button
                type="button"
                className="close-button"
                onClick={() => {
                  if (!savingRoomUnavailable) {
                    setShowRoomUnavailable(false);
                  }
                }}
                disabled={savingRoomUnavailable}
              >
                ×
              </button>
            </div>

            <div className="form">
              <label>
                Inizio indisponibilità
                <div className="time-row">
                  <DatePicker
                    selected={unavailableStartDate}
                    onChange={(date) => setUnavailableStartDate(date)}
                    onChangeRaw={(event) => event.preventDefault()}
                    locale={it}
                    dateFormat="dd/MM/yyyy"
                    minDate={new Date()}
                    showPopperArrow={false}
                    disabled={
                      unavailableUntilReactivated || savingRoomUnavailable
                    }
                  />

                  <input
                    type="time"
                    min="08:00"
                    max="18:00"
                    value={unavailableStartTime}
                    onChange={(event) =>
                      setUnavailableStartTime(event.target.value)
                    }
                    disabled={
                      unavailableUntilReactivated || savingRoomUnavailable
                    }
                  />
                </div>
              </label>

              <label>
                Fine indisponibilità
                <div className="time-row">
                  <DatePicker
                    selected={unavailableEndDate}
                    onChange={(date) => setUnavailableEndDate(date)}
                    onChangeRaw={(event) => event.preventDefault()}
                    locale={it}
                    dateFormat="dd/MM/yyyy"
                    minDate={new Date()}
                    filterDate={(date) => !isWeekend(date)}
                    showPopperArrow={false}
                    disabled={
                      unavailableUntilReactivated || savingRoomUnavailable
                    }
                  />
                  <input
                    type="time"
                    min="08:00"
                    max="18:00"
                    value={unavailableEndTime}
                    onChange={(event) =>
                      setUnavailableEndTime(event.target.value)
                    }
                    disabled={
                      unavailableUntilReactivated || savingRoomUnavailable
                    }
                  />
                </div>
              </label>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "14px",
                  marginTop: "8px",
                  marginBottom: "6px",
                }}
              >
                <span
                  style={{
                    fontSize: "16px",
                    fontWeight: 700,
                    color: "#1f2937",
                    lineHeight: 1.4,
                  }}
                >
                  Non disponibile fino a riattivazione
                </span>

                <button
                  type="button"
                  role="switch"
                  aria-checked={unavailableUntilReactivated}
                  onClick={() => {
                    const newValue = !unavailableUntilReactivated;

                    setUnavailableUntilReactivated(newValue);

                    if (newValue) {
                      /*
                       * Quando viene attivata l'opzione,
                       * aggiorniamo immediatamente la data e l'ora
                       * in base all'ora attuale.
                       */
                      const now = new Date();

                      const roundedMinutes =
                        Math.ceil(
                          (now.getMinutes() + now.getSeconds() / 60) / 5,
                        ) * 5;

                      const automaticStart = new Date(now);

                      if (roundedMinutes >= 60) {
                        automaticStart.setHours(automaticStart.getHours() + 1);
                        automaticStart.setMinutes(0, 0, 0);
                      } else {
                        automaticStart.setMinutes(roundedMinutes, 0, 0);
                      }

                      setUnavailableStartDate(automaticStart);

                      setUnavailableStartTime(
                        `${String(automaticStart.getHours()).padStart(
                          2,
                          "0",
                        )}:${String(automaticStart.getMinutes()).padStart(
                          2,
                          "0",
                        )}`,
                      );
                    }
                  }}
                  disabled={savingRoomUnavailable}
                  style={{
                    position: "relative",
                    flexShrink: 0,
                    width: "56px",
                    height: "30px",
                    padding: 0,
                    border: "none",
                    borderRadius: "999px",
                    backgroundColor: unavailableUntilReactivated
                      ? "#2563eb"
                      : "#cbd5e1",
                    cursor: savingRoomUnavailable ? "default" : "pointer",
                    transition:
                      "background-color 0.2s ease, box-shadow 0.2s ease",
                    boxShadow: unavailableUntilReactivated
                      ? "0 2px 8px rgba(37, 99, 235, 0.3)"
                      : "inset 0 1px 2px rgba(0, 0, 0, 0.12)",
                    opacity: savingRoomUnavailable ? 0.6 : 1,
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: "4px",
                      left: unavailableUntilReactivated ? "30px" : "4px",
                      width: "22px",
                      height: "22px",
                      borderRadius: "50%",
                      background: "#ffffff",
                      boxShadow: "0 1px 4px rgba(0, 0, 0, 0.25)",
                      transition: "left 0.2s ease",
                    }}
                  />
                </button>
              </div>

              {unavailableUntilReactivated && (
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: "8px",
                    background: "#fff7ed",
                    color: "#9a3412",
                    fontSize: "13px",
                    fontWeight: 600,
                    lineHeight: 1.5,
                  }}
                >
                  La sala rimarrà indisponibile a tempo indeterminato finché un
                  amministratore non la riattiverà.
                </div>
              )}

              {unavailableError && (
                <div className="form-error">{unavailableError}</div>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="cancel-button"
                  onClick={() => setShowRoomUnavailable(false)}
                  disabled={savingRoomUnavailable}
                >
                  Annulla
                </button>

                <button
                  type="button"
                  className="confirm-button"
                  onClick={saveRoomUnavailable}
                  disabled={savingRoomUnavailable}
                >
                  {savingRoomUnavailable
                    ? "Salvataggio..."
                    : "Conferma indisponibilità"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBooking && (
        <div className="modal-overlay" onClick={() => setShowBooking(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="eyebrow">NUOVA PRENOTAZIONE</span>

                <h3>Prenota una sala</h3>
              </div>

              <button
                type="button"
                className="close-button"
                onClick={() => setShowBooking(false)}
              >
                ×
              </button>
            </div>

            <div className="form">
              <label>
                Stanza
                <select
                  value={selectedRoom}
                  onChange={(event) => setSelectedRoom(event.target.value)}
                >
                  {rooms.map((room) => (
                    <option key={room.id} value={room.name}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Data
                <DatePicker
                  selected={selectedDate}
                  onChange={(date) => setSelectedDate(date)}
                  onChangeRaw={(event) => event.preventDefault()}
                  locale={it}
                  dateFormat="dd/MM/yyyy"
                  minDate={new Date()}
                  filterDate={(date) => !isWeekend(date)}
                  showPopperArrow={false}
                />
                {formErrors.date && (
                  <span className="form-error">{formErrors.date}</span>
                )}
              </label>

              <div className="time-row">
                <label>
                  Ora inizio
                  <input
                    type="time"
                    min="08:00"
                    max="17:00"
                    value={startTime}
                    onChange={(event) => setStartTime(event.target.value)}
                  />
                  {formErrors.startTime && (
                    <span className="form-error">{formErrors.startTime}</span>
                  )}
                </label>

                <label>
                  Ora fine
                  <input
                    type="time"
                    min="09:00"
                    max="18:00"
                    value={endTime}
                    onChange={(event) => setEndTime(event.target.value)}
                  />
                  {formErrors.endTime && (
                    <span className="form-error">{formErrors.endTime}</span>
                  )}
                </label>
              </div>

              {formErrors.time && (
                <div className="form-error form-error-summary">
                  {formErrors.time}
                </div>
              )}

              <label className="reason-field">
                Motivo della prenotazione <span>(facoltativo)</span>
                <textarea
                  value={bookingReason}
                  onChange={(event) => {
                    setBookingReason(event.target.value);

                    autoResizeTextarea(event.target);
                  }}
                  placeholder="Es. riunione con il team, incontro con un cliente..."
                  maxLength={250}
                  rows={3}
                />
              </label>

              <div className="modal-actions">
                <button
                  type="button"
                  className="cancel-button"
                  onClick={() => setShowBooking(false)}
                >
                  Annulla
                </button>

                <div className="confirm-button-wrapper">
                  <button
                    type="button"
                    className={`confirm-button ${
                      availabilityError ? "confirm-button-error" : ""
                    }`}
                    onClick={handleBooking}
                  >
                    Conferma prenotazione
                  </button>

                  {availabilityError && (
                    <span className="availability-error">
                      {availabilityError}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingBooking && (
        <div className="modal-overlay" onClick={closeEditReason}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="eyebrow">MODIFICA PRENOTAZIONE</span>

                <h3>Modifica prenotazione</h3>
              </div>

              <button
                type="button"
                className="close-button"
                onClick={closeEditReason}
              >
                ×
              </button>
            </div>

            <div className="form">
              <label>
                Stanza
                <select
                  value={editRoomId ?? ""}
                  onChange={(event) =>
                    setEditRoomId(Number(event.target.value))
                  }
                >
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Data
                <DatePicker
                  selected={editDate}
                  onChange={(date) => setEditDate(date)}
                  onChangeRaw={(event) => event.preventDefault()}
                  locale={it}
                  dateFormat="dd/MM/yyyy"
                  placeholderText="Seleziona una data"
                  minDate={new Date()}
                  filterDate={(date) => !isWeekend(date)}
                  showPopperArrow={false}
                />
              </label>

              <div className="time-row">
                <label>
                  Ora inizio
                  <input
                    type="time"
                    min="08:00"
                    max="17:00"
                    value={editStartTime}
                    onChange={(event) => setEditStartTime(event.target.value)}
                  />
                </label>

                <label>
                  Ora fine
                  <input
                    type="time"
                    min="09:00"
                    max="18:00"
                    value={editEndTime}
                    onChange={(event) => setEditEndTime(event.target.value)}
                  />
                </label>
              </div>

              <label className="reason-field">
                Motivo della prenotazione <span>(facoltativo)</span>
                <textarea
                  ref={editTextareaRef}
                  value={editReason}
                  onChange={(event) => {
                    setEditReason(event.target.value);

                    autoResizeTextarea(event.target);
                  }}
                  placeholder="Es. riunione con il team, incontro con un cliente..."
                  maxLength={250}
                  rows={3}
                  autoFocus
                />
              </label>

              <div className="modal-actions">
                <button
                  type="button"
                  className="cancel-button"
                  onClick={closeEditReason}
                >
                  Annulla
                </button>

                <button
                  type="button"
                  className="confirm-button"
                  onClick={handleSaveEditReason}
                >
                  Salva modifiche
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
