export interface Device { id: number; name: string; uniqueId: string; status: string; lastUpdate?: string; model?: string; phone?: string; attributes?: Record<string, unknown>; }
export interface Position { id: number; deviceId: number; valid: boolean; latitude: number; longitude: number; speed: number; fixTime: string; attributes: { ignition?: boolean; motion?: boolean }; }
export interface User { id: number; name: string; email: string; administrator: boolean; readonly?: boolean; deviceReadonly?: boolean; disabled?: boolean; attributes?: Record<string, unknown>; }
export interface Server { newServer: boolean; registration: boolean; readonly?: boolean; deviceReadonly?: boolean; }
export interface Config { title: string; tileUrl: string; tileAttribution: string; center: [number, number]; zoom: number; }
