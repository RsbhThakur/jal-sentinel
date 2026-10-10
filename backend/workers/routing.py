"""
Dynamic A* Evacuation Routing Engine.
Maintains a NetworkX directed road network graph for Guwahati, calculates
dynamic edge weights factoring in predicted flood depths and structural hazards,
and enforces vehicle-clearance safety thresholds.
"""
import os
import json
import math
import heapq
import logging
from typing import Dict, List, Optional, Tuple, Any
import networkx as nx

from backend.utils.geospatial import geo_to_h3, haversine_distance

logger = logging.getLogger("jal_sentinel.routing")

# Vehicle clearance thresholds in centimeters
CLEARANCE_THRESHOLDS: Dict[str, float] = {
    "walker": 15.0,
    "scooty": 20.0,
    "sedan": 35.0,
    "suv": 55.0,
}

# Alpha and Beta penalty coefficients from the core JAL-SENTINEL specification
ALPHA_DEPTH_PENALTY: float = 0.05
BETA_HAZARD_PENALTY: float = 10.0

DEFAULT_GRAPH_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "guwahati_graph.json"
)



def compute_edge_weight(
    physical_length: float,
    h_pred: float,
    hazard_flag: int,
    vehicle_class: str
) -> float:
    """
    Computes dynamic edge transit cost:
    W(e) = d(e) * (1 + 0.05 * h_pred(e) + 10 * hazard_flag(e))
    Blocks edge (returns inf) if h_pred > clearance_threshold[vehicle_class].
    """
    vehicle_key = vehicle_class.lower()
    threshold = CLEARANCE_THRESHOLDS.get(vehicle_key, 20.0)

    if h_pred > threshold:
        return float("inf")

    cost = physical_length * (1.0 + ALPHA_DEPTH_PENALTY * h_pred + BETA_HAZARD_PENALTY * hazard_flag)
    return cost



class EvacuationRouter:
    """
    Guwahati Street Network Evacuation Router backed by NetworkX DiGraph and
    priority-queue A* algorithm.
    """

    def __init__(self, graph_path: str = DEFAULT_GRAPH_PATH):
        self.graph_path = graph_path
        self.graph: nx.DiGraph = nx.DiGraph()
        self.node_coords: Dict[str, Tuple[float, float]] = {}
        self.load_graph()

    def load_graph(self) -> None:
        """Loads pre-baked GeoJSON street graph into a NetworkX DiGraph."""
        if not os.path.exists(self.graph_path):
            raise FileNotFoundError(f"Street network graph not found at {self.graph_path}")

        logger.info(f"Loading Guwahati street network graph from {self.graph_path}...")
        with open(self.graph_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        g = nx.DiGraph()
        coords = {}

        for n in data.get("nodes", []):
            nid = n["id"]
            lat = float(n["lat"])
            lng = float(n["lng"])
            coords[nid] = (lat, lng)
            g.add_node(
                nid,
                lat=lat,
                lng=lng,
                name=n.get("name", nid),
                is_landmark=n.get("is_landmark", False)
            )

        for e in data.get("edges", []):
            u = e["u"]
            v = e["v"]
            length = float(e["length"])
            g.add_edge(
                u,
                v,
                length=length,
                h_pred=float(e.get("h_pred", 0.0)),
                hazard_flag=int(e.get("hazard_flag", 0)),
                road_type=e.get("road_type", "residential")
            )

        self.graph = g
        self.node_coords = coords
        logger.info(
            f"Successfully loaded Guwahati street graph: {g.number_of_nodes()} nodes, "
            f"{g.number_of_edges()} directed edges."
        )

    def find_nearest_node(self, lat: float, lng: float) -> str:
        """
        Locates the closest street graph node to the requested coordinate
        using Euclidean square approximation for speed.
        """
        best_node = None
        min_dist_sq = float("inf")

        for nid, (nlat, nlng) in self.node_coords.items():
            d_sq = (nlat - lat) ** 2 + (nlng - lng) ** 2
            if d_sq < min_dist_sq:
                min_dist_sq = d_sq
                best_node = nid

        if best_node is None:
            raise ValueError(f"No nodes found in graph near coordinate ({lat}, {lng})")
        return best_node

    def find_route_astar(
        self,
        origin_node: str,
        dest_node: str,
        vehicle_class: str,
        edge_weight_overrides: Optional[Dict[Tuple[str, str], Dict[str, float]]] = None
    ) -> Optional[Tuple[List[str], float, float, int]]:
        """
        Executes A* search with heapq priority queue on the street network graph.
        Returns:
            Tuple of (path_node_ids, total_distance_meters, total_penalized_cost, hazard_count)
            or None if no path exists under clearance constraints.
        """
        if origin_node not in self.graph or dest_node not in self.graph:
            return None

        if origin_node == dest_node:
            return ([origin_node], 0.0, 0.0, 0)

        dest_lat, dest_lng = self.node_coords[dest_node]
        start_lat, start_lng = self.node_coords[origin_node]

        # Priority queue stores tuples: (f_score, g_cost, physical_distance, hazard_count, max_depth, current_node, path)
        start_h = haversine_distance(start_lat, start_lng, dest_lat, dest_lng)
        pq: List[Tuple[float, float, float, int, float, str, List[str]]] = [
            (start_h, 0.0, 0.0, 0, 0.0, origin_node, [origin_node])
        ]

        best_g: Dict[str, float] = {origin_node: 0.0}
        visited: set = set()
        overrides = edge_weight_overrides or {}

        while pq:
            f, g, phys_dist, hazards_avoided, max_depth, u, path = heapq.heappop(pq)

            if u in visited:
                continue
            visited.add(u)

            if u == dest_node:
                return (path, phys_dist, g, hazards_avoided, max_depth)

            for v in self.graph.neighbors(u):
                if v in visited:
                    continue

                edge_data = self.graph[u][v]
                length = edge_data.get("length", 100.0)
                h_pred = edge_data.get("h_pred", 0.0)
                hazard_flag = edge_data.get("hazard_flag", 0)

                if (u, v) in overrides:
                    override = overrides[(u, v)]
                    h_pred = override.get("h_pred", h_pred)
                    hazard_flag = int(override.get("hazard_flag", hazard_flag))

                edge_weight = compute_edge_weight(length, h_pred, hazard_flag, vehicle_class)

                if math.isinf(edge_weight):
                    continue

                ng = g + edge_weight
                if ng < best_g.get(v, float("inf")):
                    best_g[v] = ng
                    vlat, vlng = self.node_coords[v]
                    h = haversine_distance(vlat, vlng, dest_lat, dest_lng)
                    new_hazards = hazards_avoided + (1 if hazard_flag > 0 else 0)
                    new_max_depth = max(max_depth, h_pred)
                    heapq.heappush(
                        pq,
                        (ng + h, ng, phys_dist + length, new_hazards, new_max_depth, v, path + [v])
                    )

        return None

    def compute_route(
        self,
        origin_lat: float,
        origin_lng: float,
        dest_lat: float,
        dest_lng: float,
        vehicle_class: str,
        edge_weight_overrides: Optional[Dict[Tuple[str, str], Dict[str, float]]] = None
    ) -> Dict[str, Any]:
        """
        High-level route computation: snaps coords to graph, solves A*, and
        formats the response into a canonical GeoJSON LineString Feature.
        """
        vehicle_key = vehicle_class.lower()
        if vehicle_key not in CLEARANCE_THRESHOLDS:
            raise ValueError(
                f"Invalid vehicle class '{vehicle_class}'. Allowed classes: {list(CLEARANCE_THRESHOLDS.keys())}"
            )

        origin_node = self.find_nearest_node(origin_lat, origin_lng)
        dest_node = self.find_nearest_node(dest_lat, dest_lng)

        route_result = self.find_route_astar(
            origin_node,
            dest_node,
            vehicle_key,
            edge_weight_overrides=edge_weight_overrides
        )

        origin_hex = geo_to_h3(origin_lat, origin_lng, resolution=12)
        dest_hex = geo_to_h3(dest_lat, dest_lng, resolution=12)

        if not route_result:
            return {
                "success": False,
                "message": f"No safe evacuation corridor available for {vehicle_key} due to flood blockages.",
                "vehicle_class": vehicle_key,
                "clearance_threshold_cm": CLEARANCE_THRESHOLDS[vehicle_key],
                "origin_hex": origin_hex,
                "dest_hex": dest_hex,
                "distance_meters": 0.0,
                "estimated_minutes": 0.0,
                "route_geojson": None
            }

        path_nodes, distance_meters, total_cost, hazards_encountered, max_depth_encountered = route_result

        coordinates: List[List[float]] = []
        for nid in path_nodes:
            lat, lng = self.node_coords[nid]
            coordinates.append([lng, lat])

        if coordinates and (coordinates[0][1] != origin_lat or coordinates[0][0] != origin_lng):
            coordinates.insert(0, [origin_lng, origin_lat])
        if coordinates and (coordinates[-1][1] != dest_lat or coordinates[-1][0] != dest_lng):
            coordinates.append([dest_lng, dest_lat])

        estimated_minutes = round(distance_meters / 416.7, 1)
        if estimated_minutes < 1.0 and distance_meters > 0:
            estimated_minutes = 1.0

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": coordinates
            },
            "properties": {
                "vehicle_class": vehicle_key,
                "distance_meters": round(distance_meters, 1),
                "estimated_minutes": estimated_minutes,
                "submerged_hazards_avoided": hazards_encountered,
                "clearance_threshold_cm": CLEARANCE_THRESHOLDS[vehicle_key],
                "max_flood_depth_encountered_cm": round(max_depth_encountered, 1),
                "clearance_status": "CLEARANCE_SAFE_EVACUATION_CORRIDOR",
                "nodes_count": len(path_nodes),
                "cached": False,
                "origin_hex": origin_hex,
                "dest_hex": dest_hex
            }
        }

        return {
            "success": True,
            "vehicle_class": vehicle_key,
            "clearance_threshold_cm": CLEARANCE_THRESHOLDS[vehicle_key],
            "distance_meters": round(distance_meters, 1),
            "estimated_minutes": estimated_minutes,
            "origin_hex": origin_hex,
            "dest_hex": dest_hex,
            "route_geojson": feature
        }


_router_instance: Optional[EvacuationRouter] = None


def get_evacuation_router() -> EvacuationRouter:
    """Provides a singleton EvacuationRouter instance."""
    global _router_instance
    if _router_instance is None:
        _router_instance = EvacuationRouter()
    return _router_instance

