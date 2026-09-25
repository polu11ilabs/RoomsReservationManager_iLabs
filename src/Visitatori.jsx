import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import "./Visitatori.css";

/*
 * ============================================================
 * COSTANTI
 * ============================================================
 */

const ROW_DEFAULT_HEIGHT = 60;
const BOOKING_VISUAL_GAP = 6; // spazio fisso sopra/sotto/lati di ogni blocco
const PX_PER_MINUTE = 1; // 1px per ogni minuto (grigio, giallo, spaziatori)

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
 */

const getSlotFillFraction = (date, hour) => {
  const now = new Date();

  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (!isSameDay) {
    // giorno passato = tutto grigio, giorno futuro = niente grigio
    const cellEnd = new Date(date);
    cellEnd.setHours(hour + 1, 0, 0, 0);

    return cellEnd <= now ? 1 : 0;
  }

  if (now.getHours() > hour) {
    return 1;
  }

  if (now.getHours() < hour) {
    return 0;
  }

  return (now.getMinutes() * 60 + now.getSeconds()) / 3600;
};

const isPastSlot = (date, hour) => {
  return getSlotFillFraction(date, hour) >= 1;
};

/*
 * ============================================================
 * INDISPONIBILITÀ (in percentuale rispetto ai 60 minuti nominali)
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

  if (cellEnd <= now) {
    return [];
  }

  const parts = [];

  room.unavailability.forEach((period) => {
    const unavailableStart = new Date(period.startAt);

    const unavailableEnd = period.endAt ? new Date(period.endAt) : null;

    if (unavailableEnd && unavailableEnd <= cellStart) {
      return;
    }

    if (unavailableStart >= cellEnd) {
      return;
    }

    let visibleStart = new Date(
      Math.max(cellStart.getTime(), unavailableStart.getTime()),
    );

    const isCurrentHour = cellStart <= now && now < cellEnd;

    if (isCurrentHour && visibleStart < now) {
      visibleStart = new Date(now);
    }

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
 * APP
 * ============================================================
 */

function Visitatori() {
  const [rooms, setRooms] = useState([]);

  const [roomWeeks, setRoomWeeks] = useState({});

  const [loadingRooms, setLoadingRooms] = useState(true);

  const [roomsError, setRoomsError] = useState("");

  const bookingBlockRefs = useRef({});

  const loadDataRequestRef = useRef(0);

  const [, forceMinuteTick] = useState(0);

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

  const loadData = async () => {
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

    setRoomWeeks((previous) => {
      const next = { ...previous };

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

  useEffect(() => {
    setLoadingRooms(true);

    loadData();
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("ilabs-public-calendar-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        () => {
          loadData();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms" },
        () => {
          loadData();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_unavailability" },
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

              const weekDays = Array.from({ length: 5 }, (_, index) => {
                const date = new Date(currentWeekStart);

                date.setDate(currentWeekStart.getDate() + index);

                return date;
              });

              const weekTitle = `${weekDays[0].toLocaleDateString("it-IT", {
                day: "numeric",
                month: "long",
              })} – ${weekDays[4].toLocaleDateString("it-IT", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}`;

              return (
                <div className="calendar-room" key={room.id}>
                  <div className="calendar-room-header">
                    <div className="calendar-room-name">
                      <span
                        className="calendar-room-color"
                        style={{ backgroundColor: room.color }}
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

                    {Array.from({ length: 10 }, (_, index) => {
                      const hour = index + 8;

                      return (
                        <div
                          className="calendar-row"
                          key={hour}
                          style={{ minHeight: `${ROW_DEFAULT_HEIGHT}px` }}
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

                            const unavailabilityParts =
                              getSlotUnavailabilityParts(room, date, hour);

                            const bookingsInCell = room.bookings
                              .filter((item) => {
                                if (item.day !== dateKey) {
                                  return false;
                                }

                                const start = timeToMinutes(item.start);

                                return (
                                  start >= hour * 60 && start < (hour + 1) * 60
                                );
                              })
                              .sort(
                                (a, b) =>
                                  timeToMinutes(a.start) -
                                  timeToMinutes(b.start),
                              );

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
                                {/* PARTE GRIGIA: sempre in px, 1px = 1 minuto */}
                                {fillFraction > 0 && fillFraction < 1 && (
                                  <div
                                    className="calendar-cell-fill"
                                    style={{
                                      height: `${
                                        Math.floor(fillFraction * 60) *
                                        PX_PER_MINUTE
                                      }px`,
                                      minHeight: 0,
                                      display: "block",
                                    }}
                                  />
                                )}
                                {fillFraction >= 1 && (
                                  <div
                                    className="calendar-cell-fill"
                                    style={{
                                      height: "100%",
                                      display: "block",
                                    }}
                                  />
                                )}

                                {/* PARTE GIALLA: in px, convertita dalla percentuale */}
                                {!past &&
                                  unavailabilityParts.map((part, partIndex) => (
                                    <div
                                      key={`unavailability-${room.id}-${dateKey}-${hour}-${partIndex}`}
                                      className="calendar-cell-unavailable"
                                      style={{
                                        top: `${
                                          (part.top / 100) * ROW_DEFAULT_HEIGHT
                                        }px`,
                                        height: `${
                                          (part.height / 100) *
                                          ROW_DEFAULT_HEIGHT
                                        }px`,
                                      }}
                                    />
                                  ))}

                                {/* PRENOTAZIONI, impilate con spaziatori in px */}
                                {bookingsInCell.map((booking, index) => {
                                  const startMinutes = timeToMinutes(
                                    booking.start,
                                  );
                                  const endMinutes = timeToMinutes(booking.end);
                                  const hourStart = hour * 60;

                                  const prevEndMinutes =
                                    index === 0
                                      ? hourStart
                                      : timeToMinutes(
                                          bookingsInCell[index - 1].end,
                                        );

                                  const minutesBefore = Math.max(
                                    0,
                                    startMinutes - prevEndMinutes,
                                  );

                                  const spacerHeight =
                                    minutesBefore * PX_PER_MINUTE;

                                  return (
                                    <div
                                      key={booking.id}
                                      style={{ position: "relative" }}
                                    >
                                      {spacerHeight > 0 && (
                                        <div
                                          style={{
                                            height: `${spacerHeight}px`,
                                            flexShrink: 0,
                                          }}
                                        />
                                      )}

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
                                          position: "relative",
                                          margin: `${BOOKING_VISUAL_GAP}px ${BOOKING_VISUAL_GAP}px`,
                                          boxSizing: "border-box",
                                          borderRadius: "8px",
                                          overflow: "visible",
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

                                      {index === bookingsInCell.length - 1 &&
                                        endMinutes % 60 !== 0 && (
                                          <div
                                            style={{
                                              height: "15px",
                                              flexShrink: 0,
                                            }}
                                          />
                                        )}
                                    </div>
                                  );
                                })}
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
      </main>

      <footer className="footer">
        <span>© 2026 I-LABS</span>

        <span>Visualizzazione disponibilità sale</span>
      </footer>
    </div>
  );
}

export default Visitatori;
