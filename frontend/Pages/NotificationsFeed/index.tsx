import React, { useCallback, useContext, useEffect, useState } from 'react'
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native'
import { AppContext } from '../../Contexts/AppContext'
import SInfo from 'react-native-sensitive-info'
import { getMentionNotes, Note } from '../../Functions/DatabaseFunctions/Notes'
import NoteCard from '../../Components/NoteCard'
import { RelayPoolContext } from '../../Contexts/RelayPoolContext'
import { Kind } from 'nostr-tools'
import { handleInfinityScroll } from '../../Functions/NativeFunctions'
import { UserContext } from '../../Contexts/UserContext'
import { ActivityIndicator, Button, Text, useTheme } from 'react-native-paper'
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons'
import { useTranslation } from 'react-i18next'
import { navigate } from '../../lib/Navigation'
import { useFocusEffect } from '@react-navigation/native'
import { getUnixTime } from 'date-fns'
import { Config } from '../../Functions/DatabaseFunctions/Config'
import { FlashList, ListRenderItem } from '@shopify/flash-list'
import { getETags } from '../../Functions/RelayFunctions/Events'

export const NotificationsFeed: React.FC = () => {
  const theme = useTheme()
  const { t } = useTranslation('common')
  const { database, setNotificationSeenAt, pushedTab } = useContext(AppContext)
  const { publicKey, reloadLists, mutedEvents } = useContext(UserContext)
  const initialPageSize = 10
  const { lastEventId, relayPool } = useContext(RelayPoolContext)
  const [pageSize, setPageSize] = useState<number>(initialPageSize)
  const [notes, setNotes] = useState<Note[]>([])
  const [refreshing, setRefreshing] = useState(true)
  const flashListRef = React.useRef<FlashList<Note>>(null)

  useFocusEffect(
    React.useCallback(() => {
      subscribeNotes()
      loadNotes()
      updateLastSeen()
      return () => {
        relayPool?.unsubscribe([
          'notification-feed',
          'notification-replies',
          'notification-reactions',
          'notification-reposts',
        ])
        updateLastSeen()
      }
    }, []),
  )

  useEffect(() => {
    loadNotes()
    reloadLists()
    setRefreshing(false)
  }, [lastEventId])

  useEffect(() => {
    if (mutedEvents.length > 0) loadNotes()
  }, [mutedEvents])

  useEffect(() => {
    if (pageSize > initialPageSize) {
      subscribeNotes()
      loadNotes()
    }
  }, [pageSize])

  useEffect(() => {
    if (pushedTab) {
      flashListRef.current?.scrollToIndex({ animated: true, index: 0 })
    }
  }, [pushedTab])

  const updateLastSeen: () => void = () => {
    const unixtime = getUnixTime(new Date())
    setNotificationSeenAt(unixtime)
    SInfo.getItem('config', {}).then((result) => {
      const config: Config = JSON.parse(result)
      config.last_notification_seen_at = unixtime
      SInfo.setItem('config', JSON.stringify(config), {})
    })
  }

  const subscribeNotes: () => void = async () => {
    if (!publicKey) return

    relayPool?.subscribe('notification-feed', [
      {
        kinds: [Kind.Text],
        '#p': [publicKey],
        limit: pageSize,
      },
      {
        kinds: [Kind.Text],
        '#e': [publicKey],
        limit: pageSize,
      },
      {
        kinds: [30001],
        authors: [publicKey],
      },
    ])
  }

  const loadNotes: () => void = () => {
    if (database && publicKey) {
      getMentionNotes(database, publicKey, pageSize).then(async (notes) => {
        const unmutedThreads = notes.filter((note) => {
          if (!note?.id) return false
          const eTags = getETags(note)
          return !eTags.some((tag) => mutedEvents.includes(tag[1]))
        })
        setNotes(unmutedThreads)
        setRefreshing(false)
        if (notes.length > 0) {
          const notedIds = notes.map((note) => note.id ?? '')
          const authors = notes.map((note) => note.pubkey ?? '')
          const repostIds = notes
            .filter((note) => note.repost_id)
            .map((note) => note.repost_id ?? '')

          relayPool?.subscribe('notification-reactions', [
            {
              kinds: [Kind.Metadata],
              authors,
            },
            {
              kinds: [Kind.Text, Kind.Reaction, 9735],
              '#e': notedIds,
            },
          ])
          if (repostIds.length > 0) {
            relayPool?.subscribe('notification-reposts', [
              {
                kinds: [Kind.Text],
                ids: repostIds,
              },
            ])
          }
        }
      })
    }
  }

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    if (relayPool && publicKey) {
      subscribeNotes()
    }
  }, [])

  const renderItem: ListRenderItem<Note> = ({ item }) => {
    return (
      <View style={styles.noteCard} key={item.id}>
        <NoteCard note={item} />
      </View>
    )
  }

  const onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void = (event) => {
    if (handleInfinityScroll(event)) {
      setPageSize(pageSize + initialPageSize)
    }
  }

  const ListEmptyComponent = React.useMemo(
    () => (
      <View style={styles.blank}>
        <MaterialCommunityIcons
          name='bell-outline'
          size={64}
          style={styles.center}
          color={theme.colors.onPrimaryContainer}
        />
        <Text variant='headlineSmall' style={styles.center}>
          {t('notificationsFeed.emptyTitle')}
        </Text>
        <Text variant='bodyMedium' style={styles.center}>
          {t('notificationsFeed.emptyDescription')}
        </Text>
        <Button mode='contained' compact onPress={() => navigate('Send')}>
          {t('notificationsFeed.emptyButton')}
        </Button>
      </View>
    ),
    [],
  )

  return (
    <View style={styles.container}>
      <FlashList
        showsVerticalScrollIndicator={false}
        data={notes}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onScroll={onScroll}
        refreshing={refreshing}
        ListEmptyComponent={ListEmptyComponent}
        horizontal={false}
        ListFooterComponent={
          notes.length > 0 ? <ActivityIndicator style={styles.loading} animating={true} /> : <></>
        }
        ref={flashListRef}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  loading: {
    paddingTop: 16,
  },
  container: {
    flex: 1,
    paddingLeft: 16,
    paddingRight: 16,
  },
  noteCard: {
    marginBottom: 16,
  },
  center: {
    alignContent: 'center',
    textAlign: 'center',
  },
  blank: {
    justifyContent: 'space-between',
    height: 220,
    marginTop: 139,
    paddingLeft: 16,
    paddingRight: 16,
  },
})

export default NotificationsFeed
