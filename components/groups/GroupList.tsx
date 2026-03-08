import { Animated, FlatList, Text, TouchableOpacity } from 'react-native'
import { Colors } from '../../constants/Colors'

export type GroupItem = { id: string; name: string; members: number }

export function GroupList({
  groups,
  joined,
  pinned,
  memberCounts,
  onJoin,
  onOpen,
  onTogglePin,
  scheme,
  activeId,
  openingAnim,
}: {
  groups: GroupItem[]
  joined: Set<string>
  pinned: Set<string>
  memberCounts: Record<string, number>
  onJoin: (id: string) => void
  onOpen: (id: string) => void
  onTogglePin: (id: string) => void
  scheme: 'light' | 'dark' | null | undefined
  activeId?: string | null
  openingAnim?: Animated.Value
}) {
  const C = Colors[scheme ?? 'light']
  return (
    <FlatList
      data={groups}
      keyExtractor={(g) => g.id}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20, gap: 10 }}
      renderItem={({ item }) => {
        const active = activeId === item.id
        const scale = active && openingAnim ? openingAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.96] }) : (1 as any)
        const opacity = active && openingAnim ? openingAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.9] }) : (1 as any)
        const count = memberCounts[item.id] ?? 0
        return (
          <Animated.View style={{ borderWidth: 1, borderColor: C.border, backgroundColor: C.card, borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3, transform: [{ scale }], opacity }}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Ouvrir le groupe" onPress={() => joined.has(item.id) ? onOpen(item.id) : onJoin(item.id)} style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontWeight: '900', fontSize: 16 }}>{item.name}</Text>
              <Text style={{ color: C.muted, marginTop: 4 }}>{count} membres</Text>
            </TouchableOpacity>
            {joined.has(item.id) ? (
              <TouchableOpacity onPress={() => onOpen(item.id)} accessibilityRole="button" style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, backgroundColor: C.tint, borderWidth: 1, borderColor: C.tint }}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>Ouvrir</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={() => onJoin(item.id)} accessibilityRole="button" style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, backgroundColor: C.tint, borderWidth: 1, borderColor: C.tint }}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>Rejoindre</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => onTogglePin(item.id)} style={{ marginLeft: 10, padding: 6 }}>
              <Text style={{ color: pinned.has(item.id) ? C.tint : C.muted, fontSize: 16 }}>📌</Text>
            </TouchableOpacity>
          </Animated.View>
        )
      }}
    />
  )
}
