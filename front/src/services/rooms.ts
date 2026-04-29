import { request } from "./auth";

export type PublicRoom = {
  room_uuid: string;
  room_code: string;
  room_name: string;
  privacy: "OPEN" | "PRIVATE";
  game_state: "WAITING" | "STARTING" | "PLAYING";
  host?: string | null;
  players_connected: number;
  players_total: number;
  score_objective: number;
  question_duration: number;
  rounds_to_win: number;
};

export type CreateRoomPayload = {
  room_name: string;
  player_uuid: string;
  pseudo?: string;
  privacy?: "OPEN" | "PRIVATE";
  configurations?: {
    score_objective: number;
    question_duration: number;
    rounds_to_win: number;
  };
};

export type CreateRoomResponse = {
  room_uuid: string;
  room_code: string;
};

export const fetchPublicRooms = async (): Promise<PublicRoom[]> =>
  request<PublicRoom[]>("/rooms/public");

export const createRoom = async (
  payload: CreateRoomPayload,
): Promise<CreateRoomResponse> =>
  request<CreateRoomResponse>("/rooms", {
    method: "POST",
    body: JSON.stringify(payload),
  });
