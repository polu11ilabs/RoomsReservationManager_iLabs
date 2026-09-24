import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import "./Visitatori.css";

/*
 * ============================================================
 * COSTANTI
 * ============================================================
 */

const ROW_DEFAULT_HEIGHT = 60;
const BOOKING_BASE_HEIGHT = 52;
const REASON_CHARS_PER_LINE = 24;
const REASON_LINE_HEIGHT = 15;

const dayNames = ["LUN", "MAR", "MER", "GIO", "VEN"];

/*
 * ============================================================
 * FUNZIONI DI SUPPORTO
 * ============================================================
 */

const getMonday = (date) => {
  const result = new Date(date);

  result.setHours(0, 0, 0, 0);

  const day = result.getDay();

  const diff = day === 0 ? -6 : 1 - day;

  result.setDate(result.getDate() + diff);

  return result;
};

const formatDateKey = (date) => {
  const year = date.getFullYear();

  const month = String(date.getMonth() + 1).padStart(2, "0");

  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const timeToMinutes = (time) => {
  if (!time) {
    return 0;
  }

  const [hours, minutes] = String(time).split(":").map(Number);

  return hours * 60 + minutes;
};

const minutesToTime = (minutes) => {
  const hours = Math.floor(minutes / 60);

  const mins = minutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
};

const normalizeTime = (time) => {
  if (!time) {
    return "";
  }

  return String(time).slice(0, 5);
};

/*
 * ============================================================
 * STATO PRENOTAZIONE
 * ============================================================
 */

const isBookingExpired = (booking) => {
  const today = formatDateKey(new Date());

  if (booking.day < today) {
    return true;
  }

  if (booking.day > today) {
    return false;
  }

  const now = new Date();

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  return currentMinutes >= timeToMinutes(booking.end);
};

const isBookingActive = (booking) => {
  const today = formatDateKey(new Date());

  if (booking.day !== today) {
    return false;
  }

  const now = new Date();

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const start = timeToMinutes(booking.start);
  const end = timeToMinutes(booking.end);

  return currentMinutes >= start && currentMinutes < end;
};

/*
 * ============================================================
 * ORA CORRENTE / CELLA PASSATA
 * ============================================================
 *
 * Restituisce:
 *
 * 0   = nessuna parte della cella è trascorsa
 * 0.5 = metà cella è trascorsa
 * 1   = cella completamente trascorsa
 *
 * È questa funzione che permette alla parte grigia
 * di avanzare insieme alla parte gialla.
 * ============================================================
 */

const getSlotPastFraction = (date, hour) => {
  const now = new Date();

  const cellStart = new Date(date);
  cellStart.setHours(hour, 0, 0, 0);

  const cellEnd = new Date(date);
  cellEnd.setHours(hour + 1, 0, 0, 0);

  /*
   * Giorno precedente / ora precedente.
   */
  if (cellEnd <= now) {
    return 1;
  }

  /*
   * Giorno successivo / ora futura.
   */
  if (cellStart >= now) {
    return 0;
  }

  /*
   * Siamo dentro l'ora corrente.
   */
  const elapsed = now.getTime() - cellStart.getTime();

  const duration = cellEnd.getTime() - cellStart.getTime();

  return Math.max(0, Math.min(1, elapsed / duration));
};

const isPastSlot = (date, hour) => {
  return getSlotPastFraction(date, hour) >= 1;
};

/*
 * ============================================================
 * INDISPONIBILITÀ
 * ============================================================
 *
 * Calcola esattamente quale parte della cella deve essere
 * colorata di giallo.
 *
 * Esempio:
 *
 * ore 14:00 - 15:00
 * ora attuale 14:20
 * indisponibilità 14:00 - 16:00
 *
 * risultato:
 *
 * 14:00 - 14:20 = GRIGIO
 * 14:20 - 15:00 = GIALLO
 *
 * Nella cella successiva:
 *
 * 15:00 - 16:00 = GIALLO
 *
 * ============================================================
 */

const getSlotUnavailabilityParts = (room, date, hour) => {
  if (!room?.unavailability?.length) {
    return [];
  }

  const cellStart = new Date(date);
  cellStart.setHours(hour, 0, 0, 0);

  const cellEnd = new Date(date);
  cellEnd.setHours(hour + 1, 0, 0, 0);

  const now = new Date();

  /*
   * Se l'intera cella è già trascorsa,
   * non deve esserci giallo.
   */
  if (cellEnd <= now) {
    return [];
  }

  const parts = [];

  room.unavailability.forEach((period) => {
    const unavailableStart = new Date(period.startAt);

    const unavailableEnd = period.endAt ? new Date(period.endAt) : null;

    /*
     * L'indisponibilità è terminata prima
     * dell'inizio della cella.
     */
    if (unavailableEnd && unavailableEnd <= cellStart) {
      return;
    }

    /*
     * L'indisponibilità inizia dopo
     * la fine della cella.
     */
    if (unavailableStart >= cellEnd) {
      return;
    }

    /*
     * Punto iniziale dell'indisponibilità
     * dentro questa cella.
     */
    let visibleStart = new Date(
      Math.max(cellStart.getTime(), unavailableStart.getTime()),
    );

    /*
     * Se siamo nell'ora corrente,
     * non dobbiamo colorare di giallo
     * la parte già trascorsa.
     *
     * Il giallo deve quindi iniziare
     * esattamente da "now".
     */
    const isCurrentHour = cellStart <= now && now < cellEnd;

    if (isCurrentHour && visibleStart < now) {
      visibleStart = new Date(now);
    }

    /*
     * Punto finale dell'indisponibilità
     * dentro questa cella.
     *
     * NULL = indisponibilità indefinita.
     */
    const visibleEnd = new Date(
      Math.min(
        cellEnd.getTime(),
        unavailableEnd ? unavailableEnd.getTime() : cellEnd.getTime(),
      ),
    );

    if (visibleEnd <= visibleStart) {
      return;
    }

    const cellDuration = cellEnd.getTime() - cellStart.getTime();

    const top =
      ((visibleStart.getTime() - cellStart.getTime()) / cellDuration) * 100;

    const height =
      ((visibleEnd.getTime() - visibleStart.getTime()) / cellDuration) * 100;

    if (height <= 0) {
      return;
    }

    parts.push({
      top: Math.max(0, Math.min(100, top)),
      height: Math.max(0, Math.min(100 - top, height)),
    });
  });

  return parts;
};

/*
 * ============================================================
 * ALTEZZA PRENOTAZIONI
 * ============================================================
 */

const estimateBookingContentHeight = (booking) => {
  const nameLength = String(booking.name || "").length;

  const reasonLength = String(booking.reason || "").length;

  const nameLines = Math.max(1, Math.ceil(nameLength / 25));

  const reasonLines = reasonLength
    ? Math.max(1, Math.ceil(reasonLength / REASON_CHARS_PER_LINE))
    : 0;

  return (
    BOOKING_BASE_HEIGHT +
    Math.max(0, nameLines - 1) * REASON_LINE_HEIGHT +
    reasonLines * REASON_LINE_HEIGHT
  );
};

const computeBookingBlockOffset = (booking, rowHeights) => {
  const startMinutes = timeToMinutes(booking.start);

  const hour = Math.floor(startMinutes / 60);

  const hourIndex = hour - 8;

  if (hourIndex < 0 || hourIndex >= rowHeights.length) {
    return 0;
  }

  const rowHeight = rowHeights[hourIndex] || ROW_DEFAULT_HEIGHT;

  const minutesIntoHour = startMinutes % 60;

  return (minutesIntoHour / 60) * rowHeight;
};

const computeBookingBlockHeight = (booking, rowHeights) => {
  const startMinutes = timeToMinutes(booking.start);
  const endMinutes = timeToMinutes(booking.end);

  const duration = Math.max(0, endMinutes - startMinutes);

  if (duration <= 0) {
    return BOOKING_BASE_HEIGHT;
  }

  let height = 0;
  let currentMinutes = startMinutes;

  while (currentMinutes < endMinutes) {
    const hour = Math.floor(currentMinutes / 60);
    const hourIndex = hour - 8;

    const nextHour = Math.min(endMinutes, (hour + 1) * 60);

    const minutesInThisHour = nextHour - currentMinutes;
    const rowHeight = rowHeights[hourIndex] || ROW_DEFAULT_HEIGHT;

    height += (minutesInThisHour / 60) * rowHeight;

    currentMinutes = nextHour;
  }

  return Math.max(height - 4, 1);
};

/*
 * ============================================================
 * APP
 * ============================================================
 */

function Visitatori() {
  /*
   * ------------------------------------------------------------
   * STATO
   * ------------------------------------------------------------
   */

  const [rooms, setRooms] = useState([]);

  const [roomWeeks, setRoomWeeks] = useState({});

  const [loadingRooms, setLoadingRooms] = useState(true);

  const [roomsError, setRoomsError] = useState("");

  const [measuredBookingHeights, setMeasuredBookingHeights] = useState({});

  const bookingBlockRefs = useRef({});

  const loadDataRequestRef = useRef(0);

  /*
   * Tick per aggiornare automaticamente
   * le parti temporali del calendario.
   */
  const [, forceMinuteTick] = useState(0);

  /*
   * ------------------------------------------------------------
   * AGGIORNAMENTO TEMPORALE
   * ------------------------------------------------------------
   *
   * Prima aggiorniamo esattamente al cambio
   * del minuto e poi continuiamo ogni 60 secondi.
   *
   * In questo modo grigio, giallo e stato
   * delle prenotazioni rimangono sincronizzati.
   * ------------------------------------------------------------
   */

  useEffect(() => {
    let intervalId = null;
    let timeoutId = null;

    const update = () => {
      forceMinuteTick((tick) => tick + 1);
    };

    const now = new Date();

    const millisecondsToNextMinute =
      (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

    timeoutId = setTimeout(() => {
      update();

      intervalId = setInterval(update, 60000);
    }, millisecondsToNextMinute);

    return () => {
      clearTimeout(timeoutId);

      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, []);

  /*
   * ------------------------------------------------------------
   * CARICAMENTO DATI
   * ------------------------------------------------------------
   */

  const loadData = async () => {
    const requestId = ++loadDataRequestRef.current;

    setRoomsError("");

    /*
     * SALE
     */

    const { data: roomsData, error: roomsLoadError } = await supabase
      .from("rooms")
      .select("*")
      .order("id", {
        ascending: true,
      });

    if (roomsLoadError) {
      console.error("Errore caricamento sale:", roomsLoadError);

      setRoomsError("Impossibile caricare le sale dal database.");

      setLoadingRooms(false);

      return;
    }

    /*
     * PRENOTAZIONI
     */

    const { data: bookingsData, error: bookingsLoadError } = await supabase
      .from("bookings")
      .select("*")
      .order("booking_date", {
        ascending: true,
      })
      .order("start_time", {
        ascending: true,
      });

    if (bookingsLoadError) {
      console.error("Errore caricamento prenotazioni:", bookingsLoadError);

      setRoomsError("Impossibile caricare le prenotazioni dal database.");

      setLoadingRooms(false);

      return;
    }

    /*
     * INDISPONIBILITÀ SALE
     */

    const { data: unavailabilityData, error: unavailabilityLoadError } =
      await supabase.from("room_unavailability").select("*").order("start_at", {
        ascending: true,
      });

    if (unavailabilityLoadError) {
      console.error(
        "Errore caricamento indisponibilità:",
        unavailabilityLoadError,
      );

      setRoomsError("Impossibile caricare le indisponibilità delle sale.");

      setLoadingRooms(false);

      return;
    }

    /*
     * COSTRUZIONE SALE
     */

    const loadedRooms = (roomsData || [])
      .filter((room) => room.active !== false)
      .map((room) => {
        const roomBookings = (bookingsData || [])
          .filter((booking) => booking.room_id === room.id)
          .map((booking) => ({
            id: booking.id,

            name: booking.user_name || "Prenotazione",

            ownerId: booking.user_id,

            day: booking.booking_date,

            start: normalizeTime(booking.start_time),

            end: normalizeTime(booking.end_time),

            reason: booking.reason || "",
          }));

        const roomUnavailability = (unavailabilityData || [])
          .filter((item) => item.room_id === room.id)
          .map((item) => ({
            id: item.id,

            startAt: item.start_at,

            endAt: item.end_at,
          }));

        return {
          id: room.id,

          name: room.name,

          description: room.description || "",

          color: room.color || "#2563eb",

          bookings: roomBookings,

          unavailability: roomUnavailability,
        };
      });

    if (requestId !== loadDataRequestRef.current) {
      return;
    }

    setRooms(loadedRooms);

    /*
     * Inizializza la settimana corrente
     * solo per le sale che non ne hanno già una.
     */

    setRoomWeeks((previous) => {
      const next = {
        ...previous,
      };

      const currentMonday = getMonday(new Date());

      loadedRooms.forEach((room) => {
        if (!next[room.id]) {
          next[room.id] = currentMonday;
        }
      });

      return next;
    });

    setLoadingRooms(false);
  };

  /*
   * ------------------------------------------------------------
   * CARICAMENTO INIZIALE
   * ------------------------------------------------------------
   */

  useEffect(() => {
    setLoadingRooms(true);

    loadData();
  }, []);

  /*
   * ------------------------------------------------------------
   * SUPABASE REALTIME
   * ------------------------------------------------------------
   *
   * L'applicazione è pubblica e funziona
   * anche senza autenticazione.
   * ------------------------------------------------------------
   */

  useEffect(() => {
    const channel = supabase
      .channel("ilabs-public-calendar-realtime")

      /*
       * PRENOTAZIONI
       */
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

      /*
       * SALE
       */
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

      /*
       * INDISPONIBILITÀ SALE
       */
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

      .subscribe((status) => {
        console.log("Realtime calendario visitatori:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  /*
   * ------------------------------------------------------------
   * MISURAZIONE PRENOTAZIONI
   * ------------------------------------------------------------
   */

  useLayoutEffect(() => {
    const measurements = {};

    Object.entries(bookingBlockRefs.current).forEach(([bookingId, node]) => {
      if (!node) {
        return;
      }

      const height = node.getBoundingClientRect().height;

      if (height > 0) {
        measurements[bookingId] = height;
      }
    });

    if (Object.keys(measurements).length > 0) {
      setMeasuredBookingHeights(measurements);
    }
  }, [rooms]);

  /*
   * ------------------------------------------------------------
   * NAVIGAZIONE SETTIMANE
   * ------------------------------------------------------------
   */

  const changeRoomWeek = (roomId, offset) => {
    setRoomWeeks((previous) => {
      const current = previous[roomId] || getMonday(new Date());

      const next = new Date(current);

      next.setDate(next.getDate() + offset * 7);

      return {
        ...previous,

        [roomId]: next,
      };
    });
  };

  const goRoomToToday = (roomId) => {
    setRoomWeeks((previous) => ({
      ...previous,

      [roomId]: getMonday(new Date()),
    }));
  };

  /*
   * ------------------------------------------------------------
   * CONTROLLO OCCUPAZIONE
   * ------------------------------------------------------------
   */

  const isHourOccupied = (room, dateKey, hour) => {
    const slotStart = hour * 60;

    const slotEnd = (hour + 1) * 60;

    return room.bookings.some((booking) => {
      if (booking.day !== dateKey) {
        return false;
      }

      const bookingStart = timeToMinutes(booking.start);

      const bookingEnd = timeToMinutes(booking.end);

      return bookingStart < slotEnd && bookingEnd > slotStart;
    });
  };

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
            <h1>Disponibilità Sale</h1>

            <span>Visualizzazione disponibilità degli spazi aziendali</span>
          </div>
        </div>

        <div className="user">
          <div className="user-profile-button">
            <div className="user-avatar">V</div>

            <div className="user-info">
              <strong>Visitatore</strong>

              <span>Solo visualizzazione</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              window.history.pushState({}, "", "/");
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
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
            Accedi
          </button>
        </div>
      </header>

      <main className="main">
        <section className="hero">
          <div>
            <span className="eyebrow">I-LABS</span>

            <h2>
              Disponibilità delle sale
              <br />
              aziendali.
            </h2>

            <p>
              Consulta in tempo reale le prenotazioni e la disponibilità degli
              spazi.
            </p>
          </div>
        </section>

        <section className="rooms-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">DISPONIBILITÀ</span>

              <h3>Prenotazioni delle sale</h3>
            </div>
          </div>

          {loadingRooms && (
            <div
              style={{
                padding: "30px",
                textAlign: "center",
                color: "#7b8495",
              }}
            >
              Caricamento sale...
            </div>
          )}

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

              const weekDays = Array.from(
                {
                  length: 5,
                },
                (_, index) => {
                  const date = new Date(currentWeekStart);

                  date.setDate(currentWeekStart.getDate() + index);

                  return date;
                },
              );

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

              /*
               * ------------------------------------------------
               * CALCOLO ALTEZZA RIGHE
               * ------------------------------------------------
               */

              const rowHeights = Array.from(
                { length: 10 },
                () => ROW_DEFAULT_HEIGHT,
              );

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

                    <div className="room-calendar-navigation">
                      <button
                        type="button"
                        className="week-button"
                        onClick={() => changeRoomWeek(room.id, -1)}
                        title="Settimana precedente"
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
                        title="Settimana successiva"
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

                    {Array.from(
                      {
                        length: 10,
                      },
                      (_, index) => {
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
                              {String(hour).padStart(2, "0")}
                              :00
                            </div>

                            {weekDays.map((date) => {
                              const dateKey = formatDateKey(date);

                              const occupied = isHourOccupied(
                                room,
                                dateKey,
                                hour,
                              );

                              /*
                               * ====================================================
                               * PARTE TEMPORALE
                               * ====================================================
                               *
                               * pastFraction viene calcolata con lo stesso
                               * "now" utilizzato dall'indisponibilità.
                               *
                               * Quindi:
                               *
                               * 14:00 -> 14:20
                               *
                               * GRIGIO  = 0% -> 33,33%
                               * GIALLO  = 33,33% -> 100%
                               *
                               * Se l'indisponibilità parte alle 14:30:
                               *
                               * GRIGIO  = 0% -> 33,33%
                               * GIALLO  = 50% -> 100%
                               *
                               * ====================================================
                               */

                              const pastFraction = getSlotPastFraction(
                                date,
                                hour,
                              );

                              const past = pastFraction >= 1;

                              const unavailabilityParts =
                                getSlotUnavailabilityParts(room, date, hour);

                              const booking = room.bookings.find((item) => {
                                if (item.day !== dateKey) {
                                  return false;
                                }

                                const start = timeToMinutes(item.start);

                                return (
                                  start >= hour * 60 && start < (hour + 1) * 60
                                );
                              });

                              const isToday =
                                dateKey === formatDateKey(new Date());

                              const cellKey = `${dateKey}-${hour}`;

                              return (
                                <div
                                  className={`calendar-cell ${
                                    occupied ? "occupied" : ""
                                  } ${past ? "past" : ""} ${
                                    isToday ? "today-cell" : ""
                                  }`}
                                  key={cellKey}
                                >
                                  {/*
                                   * ==================================================
                                   * PARTE GRIGIA
                                   * ==================================================
                                   *
                                   * La parte grigia riempie dall'inizio
                                   * della cella fino all'ora attuale.
                                   *
                                   * È presente anche nell'ora corrente.
                                   * ==================================================
                                   */}

                                  {pastFraction > 0 && (
                                    <div
                                      className="calendar-cell-fill calendar-cell-past"
                                      style={{
                                        position: "absolute",
                                        top: 0,
                                        left: 0,
                                        right: 0,
                                        height: `${pastFraction * 100}%`,
                                        backgroundColor: "#f1f2f4",
                                        zIndex: 1,
                                        pointerEvents: "none",
                                      }}
                                    />
                                  )}

                                  {/*
                                   * ==================================================
                                   * PARTE GIALLA
                                   * ==================================================
                                   *
                                   * L'indisponibilità viene mostrata solo
                                   * nella parte non ancora trascorsa.
                                   *
                                   * Il risultato viene calcolato in percentuale
                                   * rispetto alla cella.
                                   * ==================================================
                                   */}

                                  {!past &&
                                    unavailabilityParts.map(
                                      (part, partIndex) => (
                                        <div
                                          key={`unavailability-${room.id}-${dateKey}-${hour}-${partIndex}`}
                                          className="calendar-cell-fill calendar-cell-unavailable"
                                          style={{
                                            position: "absolute",
                                            left: 0,
                                            right: 0,
                                            top: `${part.top}%`,
                                            height: `${part.height}%`,
                                            zIndex: 2,
                                            pointerEvents: "none",
                                          }}
                                        />
                                      ),
                                    )}

                                  {/*
                                   * ==================================================
                                   * PRENOTAZIONE
                                   * ==================================================
                                   */}

                                  {booking && (
                                    <div
                                      ref={(node) => {
                                        bookingBlockRefs.current[booking.id] =
                                          node;
                                      }}
                                      className={`booking-block ${
                                        isBookingActive(booking)
                                          ? "booking-block-active"
                                          : ""
                                      } ${
                                        isBookingExpired(booking)
                                          ? "booking-block-expired"
                                          : ""
                                      }`}
                                      style={{
                                        backgroundColor: isBookingExpired(
                                          booking,
                                        )
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

                                        position: "relative",
                                        left: "50%",
                                        transform: "translateX(-50%)",
                                        width: "calc(100% - 12px)",
                                        boxSizing: "border-box",
                                      }}
                                    >
                                      <div className="booking-top-row">
                                        <strong>{booking.name}</strong>
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
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      },
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="footer">
        <span>© 2026 I-LABS</span>

        <span>Visualizzazione disponibilità sale</span>
      </footer>
    </div>
  );
}

export default Visitatori;
